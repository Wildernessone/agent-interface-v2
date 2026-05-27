import { supabase } from './supabase'
import { logError } from './telemetry'

/**
 * Dropbox storage layer — mirrors driveStorage.js so the cloudStorage
 * abstraction can swap providers without callers caring.
 *
 * Auth model: PKCE OAuth 2.0 flow against Dropbox's authorize endpoint.
 * Requires VITE_DROPBOX_CLIENT_ID set in env. The user registers their
 * own Dropbox app at dropbox.com/developers — we don't store any server
 * secret. Pure user-owned credentials, consistent with the BYOK ethos.
 *
 * On successful auth, the access token + refresh token land in
 * storage_connections (provider='dropbox') and the rest of the code
 * picks them up via cloudStorage.
 */

const DROPBOX_CLIENT_ID = import.meta.env.VITE_DROPBOX_CLIENT_ID || ''

export const dropboxConfigured = () => !!DROPBOX_CLIENT_ID

// ── OAuth (PKCE) ──────────────────────────────────────────────────

function randomString(len = 64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  const arr = new Uint8Array(len)
  crypto.getRandomValues(arr)
  for (let i = 0; i < len; i++) s += chars[arr[i] % chars.length]
  return s
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  // base64url
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Kick off Dropbox OAuth. Caller redirects the browser to authorize;
 * Dropbox returns to our redirect URL with ?code=... which we exchange
 * for a token via finishDropboxAuth() on the way back in.
 */
export async function startDropboxAuth() {
  if (!DROPBOX_CLIENT_ID) throw new Error('dropbox_not_configured')
  const verifier = randomString(64)
  const challenge = await sha256(verifier)
  sessionStorage.setItem('dropbox_pkce_verifier', verifier)

  const redirectUri = `${window.location.origin}${window.location.pathname}`
  const url = new URL('https://www.dropbox.com/oauth2/authorize')
  url.searchParams.set('client_id', DROPBOX_CLIENT_ID)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('token_access_type', 'offline')  // get refresh token
  url.searchParams.set('state', 'dropbox')              // distinguishes from google callback
  window.location.assign(url.toString())
}

/**
 * Run on app load. If the URL has ?code=... and ?state=dropbox, exchange
 * the code for tokens and persist to storage_connections. Returns true
 * if it handled a callback (caller can clean the URL).
 */
export async function finishDropboxAuth() {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const state = params.get('state')
  if (!code || state !== 'dropbox') return false

  const verifier = sessionStorage.getItem('dropbox_pkce_verifier')
  if (!verifier) return false
  sessionStorage.removeItem('dropbox_pkce_verifier')

  const redirectUri = `${window.location.origin}${window.location.pathname}`
  const body = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: DROPBOX_CLIENT_ID,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  })

  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    logError('dropbox_token_exchange', new Error(`status_${res.status}`))
    return false
  }
  const json = await res.json()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false

  const expiresAt = json.expires_in
    ? new Date(Date.now() + json.expires_in * 1000).toISOString()
    : null

  await supabase.from('storage_connections').upsert({
    user_id: user.id,
    provider: 'dropbox',
    access_token: json.access_token,
    refresh_token: json.refresh_token || null,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,provider' })

  // Strip the OAuth params from the URL so a refresh doesn't re-trigger
  const clean = window.location.origin + window.location.pathname
  window.history.replaceState({}, '', clean)
  return true
}

// ── Token + refresh ───────────────────────────────────────────────

async function getDropboxConnection() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('storage_connections')
    .select('access_token, refresh_token, expires_at, root_folder_id')
    .eq('user_id', user.id)
    .eq('provider', 'dropbox')
    .maybeSingle()
  if (!data?.access_token) return null

  // Refresh if expired
  if (data.expires_at && new Date(data.expires_at) < new Date() && data.refresh_token) {
    const refreshed = await refreshDropboxToken(data.refresh_token, user.id)
    if (refreshed) return refreshed
  }
  return data
}

async function refreshDropboxToken(refreshToken, userId) {
  if (!DROPBOX_CLIENT_ID) return null
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: DROPBOX_CLIENT_ID,
  })
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) return null
  const json = await res.json()
  const expiresAt = json.expires_in
    ? new Date(Date.now() + json.expires_in * 1000).toISOString()
    : null
  await supabase.from('storage_connections')
    .update({ access_token: json.access_token, expires_at: expiresAt, updated_at: new Date().toISOString() })
    .eq('user_id', userId).eq('provider', 'dropbox')
  return { access_token: json.access_token, refresh_token: refreshToken, expires_at: expiresAt }
}

// ── Folder + upload ───────────────────────────────────────────────

async function ensureFolder(token, path) {
  // Dropbox auto-creates parent folders on upload, so we just verify it exists
  const res = await fetch('https://api.dropboxapi.com/2/files/create_folder_v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ path, autorename: false }),
  })
  // 409 = already exists, which is fine
  if (res.ok || res.status === 409) return path
  throw new Error(`dropbox_create_folder_failed_${res.status}`)
}

function buildProjectPath(project) {
  if (!project?.name) return '/Agent Interface'
  // project.name may include '/' for nested build folders. Sanitize
  // per segment so we don't strip the structural slashes.
  const segments = project.name.split('/').map(s =>
    s.replace(/[<>:"\\|?*]/g, '').slice(0, 80).trim()
  ).filter(Boolean)
  return `/Agent Interface/${segments.join('/')}`
}

// Ensure each parent in a nested path exists. Dropbox doesn't auto-
// create parent folders on upload (or rather, the behavior varies).
async function ensureNestedFolders(token, fullPath) {
  const parts = fullPath.split('/').filter(Boolean)
  let path = ''
  for (const p of parts) {
    path += '/' + p
    await ensureFolder(token, path).catch(() => {}) // 409 already-exists is ignored upstream
  }
  return fullPath
}

async function uploadFile(token, path, body) {
  let bytes
  if (body instanceof Blob) {
    bytes = await body.arrayBuffer()
  } else if (typeof body === 'string' && body.startsWith('data:')) {
    const b64 = body.split(',')[1]
    bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer
  } else if (typeof body === 'string') {
    bytes = new TextEncoder().encode(body).buffer
  } else {
    throw new Error('unsupported_body_type')
  }

  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({
        path, mode: 'add', autorename: true, mute: true, strict_conflict: false,
      }),
    },
    body: bytes,
  })
  if (!res.ok) throw new Error(`dropbox_upload_failed_${res.status}`)
  return res.json()  // {id, name, path_display, ...}
}

async function getSharedLink(token, path) {
  // Best-effort. Returns null if we can't get a link (uploaded file still
  // exists, user just won't have a clickable URL stored).
  try {
    const res = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ path, settings: { requested_visibility: 'public' } }),
    })
    if (res.ok) {
      const data = await res.json()
      return data.url || null
    }
    // 409 = link already exists, fetch it
    if (res.status === 409) {
      const list = await fetch('https://api.dropboxapi.com/2/sharing/list_shared_links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ path }),
      })
      if (list.ok) {
        const data = await list.json()
        return data.links?.[0]?.url || null
      }
    }
  } catch {}
  return null
}

/**
 * Save any tool output to the user's Dropbox.
 * Mirrors saveToDrive() — same args, same return shape.
 */
export async function saveToDropbox(output, project = null) {
  try {
    const conn = await getDropboxConnection()
    if (!conn?.access_token) return null
    const token = conn.access_token

    let ext = 'bin'
    if (output.type === 'image') ext = 'png'
    if (output.type === 'audio') ext = 'mp3'
    if (output.type === 'video') ext = 'mp4'
    if (output.type === 'document') {
      const fn = output.filename || ''
      if (fn.endsWith('.pptx')) ext = 'pptx'
      else if (fn.endsWith('.docx')) ext = 'docx'
      else if (fn.endsWith('.pdf')) ext = 'pdf'
      else if (fn.endsWith('.json')) ext = 'json'
      else if (fn.endsWith('.md')) ext = 'md'
      else if (fn.endsWith('.txt')) ext = 'txt'
    }

    let body
    if (output.url?.startsWith('data:')) {
      body = output.url
    } else if (output.url) {
      const r = await fetch(output.url)
      if (!r.ok) throw new Error(`fetch_failed_${r.status}`)
      body = await r.blob()
    } else {
      return null
    }

    const folderPath = buildProjectPath(project)
    await ensureNestedFolders(token, folderPath)

    const safePrompt = (output.prompt || output.tool || 'output').replace(/[^a-z0-9-_ ]/gi, '').slice(0, 60).trim() || 'output'
    const filename = `${Date.now()}-${output.tool}-${safePrompt}.${ext}`
    const fullPath = `${folderPath}/${filename}`

    const meta = await uploadFile(token, fullPath, body)
    const link = await getSharedLink(token, meta.path_display || fullPath)

    if (project?.id) {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          await supabase.from('project_files').insert({
            project_id: project.id,
            user_id: user.id,
            name: filename,
            file_type: output.type,
            storage_url: link,
            storage_file_id: meta.id,
            generated_by: output.tool,
            prompt_used: output.prompt?.slice(0, 1000) || null,
          })
        }
      } catch (e) {
        logError('project_files.insert_dropbox', e)
      }
    }

    return { id: meta.id, webViewLink: link }
  } catch (e) {
    logError('saveToDropbox', e, { tool: output?.tool, type: output?.type })
    return null
  }
}
