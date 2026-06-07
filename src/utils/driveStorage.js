import { supabase } from './supabase'
import { logError } from './telemetry'
import { arrayBufferToBase64 } from './base64'

const PROXY = import.meta.env.VITE_PROXY_URL || 'https://claude-proxy.jamesreed.workers.dev'

const DRIVE_OAUTH_OPTS = {
  redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
  scopes: [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/calendar.events',
  ].join(' '),
  queryParams: { access_type: 'offline', prompt: 'consent' },
}

/**
 * Connect Google Drive to the CURRENT account — the right way.
 *
 * The old flow used signInWithOAuth('google') from inside the app. For a user
 * who signed up with email/password, that SIGNS THEM IN AS their Google account
 * — i.e. it switches/creates a SEPARATE Supabase user (the Google identity) and
 * silently strands all subsequent work on that second account. That split
 * accounts and broke trust.
 *
 * Fix: if the current user already has a Google identity (they signed up with
 * Google), re-auth that same account to add Drive scopes. Otherwise LINK the
 * Google identity to the current (email) user via linkIdentity — so Drive
 * attaches to who you already are instead of forking a new account.
 *
 * NOTE: linkIdentity requires "Manual linking" enabled in Supabase Auth.
 * Returns { error } on failure so the caller can surface it.
 */
export async function connectGoogleDrive() {
  const { data: { user } } = await supabase.auth.getUser()
  const hasGoogle = (user?.identities || []).some(i => i.provider === 'google')
  if (hasGoogle) {
    // Same Google account already linked → re-authorize to grant Drive scopes.
    // This does NOT fork (the Google identity maps to this same user).
    return supabase.auth.signInWithOAuth({ provider: 'google', options: DRIVE_OAUTH_OPTS })
  }
  // Email/password user → attach Google to THIS account, don't switch to it.
  return supabase.auth.linkIdentity({ provider: 'google', options: DRIVE_OAUTH_OPTS })
}

/**
 * Capture the Google Drive OAuth tokens from the Supabase session and
 * persist them to storage_connections. Called after OAuth callback redirects
 * back to the app.
 */
export async function captureDriveTokens() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null

  // Supabase puts the Google OAuth tokens on the session
  const accessToken = session.provider_token
  const refreshToken = session.provider_refresh_token
  if (!accessToken) return null // user signed in with email/password, not Google OAuth

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Google access tokens last 1 hour. Save expires_at with a 60-second
  // safety buffer so we treat them as expired just before they actually do.
  const expiresAt = new Date(Date.now() + 3540 * 1000).toISOString()

  const { error } = await supabase.from('storage_connections').upsert({
    user_id: user.id,
    provider: 'google_drive',
    access_token: accessToken,
    refresh_token: refreshToken || null,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,provider' })

  if (error) logError('captureDriveTokens', error)
  return !error
}

/**
 * Exchange a Google refresh_token for a new access_token via our Worker proxy.
 * The Worker holds the client_secret server-side (can't ship to the browser).
 * On success, updates storage_connections with the new token + new expires_at.
 * Returns the new access_token, or null on failure.
 */
async function refreshDriveAccessToken(userId, refreshToken) {
  if (!refreshToken) return null
  try {
    const res = await fetch(`${PROXY}/refresh_google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    if (!res.ok) {
      logError('refreshDriveAccessToken', new Error(`worker_${res.status}`))
      return null
    }
    const data = await res.json()
    if (!data.access_token) return null

    // Google returns expires_in (seconds). 60s safety buffer.
    const expiresInSec = (data.expires_in || 3600) - 60
    const expiresAt = new Date(Date.now() + expiresInSec * 1000).toISOString()

    await supabase.from('storage_connections')
      .update({
        access_token: data.access_token,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('provider', 'google_drive')

    return data.access_token
  } catch (e) {
    logError('refreshDriveAccessToken', e)
    return null
  }
}

/**
 * Read the current Drive connection. If the access_token is expired or
 * close to expiring (< 5 min remaining), refresh it transparently first.
 * Returns { access_token, root_folder_id } or null if no valid connection.
 */
async function getDriveToken() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('storage_connections')
    .select('access_token, refresh_token, expires_at, root_folder_id')
    .eq('user_id', user.id)
    .eq('provider', 'google_drive')
    .maybeSingle()
  if (!data?.access_token) return null

  // If expired or about to expire, refresh.
  const expiresAt = data.expires_at ? new Date(data.expires_at) : null
  const needsRefresh = !expiresAt || expiresAt < new Date(Date.now() + 5 * 60 * 1000)

  if (needsRefresh && data.refresh_token) {
    const newToken = await refreshDriveAccessToken(user.id, data.refresh_token)
    if (newToken) return { ...data, access_token: newToken }
    // Refresh failed — fall through and try the old token; it may still work
    // for a moment, or Google's 401 will tell us to reconnect.
  }
  if (needsRefresh && !data.refresh_token) {
    // Old connection from before refresh support — no refresh_token saved.
    // The user needs to reconnect once to grant us a refresh_token.
    return null
  }
  return data
}

/**
 * Public helper for skillsLoader and other modules that need a valid
 * Drive access_token. Returns the access_token string or null.
 */
export async function getValidDriveToken() {
  const conn = await getDriveToken()
  return conn?.access_token || null
}

/**
 * Open a short-lived Drive session for one save operation.
 *
 * getDriveToken() already refreshes PROACTIVELY (when <5 min to expiry).
 * This session adds REACTIVE recovery: if Google rejects a call with 401
 * anyway — clock skew, a token revoked early, or a proactive refresh that
 * silently failed (e.g. the Worker route was momentarily down) — refresh the
 * token ONCE and retry the same request before giving up. Only if that retry
 * also fails does the caller surface "reconnect in Settings".
 *
 * All Drive API calls in this module go through `session.driveFetch`, which
 * injects the bearer token and owns the refresh-and-retry. Callers must NOT
 * set their own Authorization header.
 */
async function openDriveSession() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const conn = await getDriveToken()
  if (!conn?.access_token) return null

  let token = conn.access_token
  const refreshToken = conn.refresh_token
  let triedRefresh = false

  const driveFetch = async (url, opts = {}) => {
    const withAuth = (t) => ({ ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${t}` } })
    let res = await fetch(url, withAuth(token))
    if (res.status === 401 && !triedRefresh && refreshToken) {
      triedRefresh = true
      const fresh = await refreshDriveAccessToken(user.id, refreshToken)
      if (fresh) { token = fresh; res = await fetch(url, withAuth(token)) }
    }
    return res
  }

  return { driveFetch, userId: user.id, rootFolderId: conn.root_folder_id || null }
}

// Find or create a folder. parentId scopes BOTH the search and the create — a
// folder is only matched/created under that exact parent. (A null parentId used
// to search GLOBALLY, which is how the root folder kept resolving to a nested
// "Agent Interface" and burrowed the whole tree deeper on every build.)
async function findOrCreateFolder(session, name, parentId) {
  const parentClause = parentId ? ` and '${parentId}' in parents` : ` and 'root' in parents`
  const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentClause}`
  const search = await session.driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`
  )
  if (!search.ok) throw new Error(`drive_search_failed_${search.status}`)
  const data = await search.json()
  if (data.files?.[0]?.id) return data.files[0].id

  const body = { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId || 'root'] }
  const create = await session.driveFetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!create.ok) throw new Error(`drive_create_folder_failed_${create.status}`)
  const folder = await create.json()
  return folder.id
}

const ROOT_FOLDER_NAME = 'Agent Interface'

// Resolve the ONE top-level "Agent Interface" folder. Prefer the cached, stable
// id (never re-resolve by name — a project can also be named "Agent Interface",
// so a name search matched nested folders and nested the tree forever). Only
// fall back to a true-root-scoped find/create, then cache it.
async function ensureRootFolder(session) {
  if (session.rootFolderId) {
    const r = await session.driveFetch(
      `https://www.googleapis.com/drive/v3/files/${session.rootFolderId}?fields=id,trashed`
    )
    if (r.ok) { const f = await r.json().catch(() => null); if (f?.id && !f.trashed) return session.rootFolderId }
  }
  const id = await findOrCreateFolder(session, ROOT_FOLDER_NAME, null) // null → scoped to 'root'
  try {
    await supabase.from('storage_connections')
      .update({ root_folder_id: id })
      .eq('user_id', session.userId).eq('provider', 'google_drive')
  } catch { /* cache best-effort */ }
  return id
}

/**
 * Resolve a clickable link to the user's root "Agent Interface" Drive folder —
 * where no-project outputs are saved. Finds (or creates) the folder, caches its
 * id on the connection row (root_folder_id was previously read but never
 * written), and returns { id, link }. Returns null if Drive isn't connected.
 * Used by Storage settings + the project picker so a connected user can jump
 * straight to their files instead of hunting through Drive.
 */
export async function resolveDriveRootFolder() {
  const session = await openDriveSession()
  if (!session) return null
  try {
    const id = await ensureRootFolder(session)
    // Best-effort cache so the link is instant next time (and the column stops
    // being vestigial). A failed write must not break the returned link.
    supabase.from('storage_connections')
      .update({ root_folder_id: id })
      .eq('user_id', session.userId).eq('provider', 'google_drive')
      .then(() => {}, () => {})
    return { id, link: `https://drive.google.com/drive/folders/${id}` }
  } catch {
    return null
  }
}

/** Build a Drive folder URL from a stored folder id (e.g. project.storage_folder_id). */
export function driveFolderUrl(folderId) {
  return folderId ? `https://drive.google.com/drive/folders/${folderId}` : null
}

async function ensureProjectFolder(session, rootId, project) {
  if (!project?.name) return rootId

  // Names can be slashed paths for nested build folders, e.g.
  //   "Salt+Pine Coffee Launch/2026-05-26 — Pitch deck"
  // Drop any segment equal to the app root name — the root folder IS already
  // "Agent Interface", so a project literally named "Agent Interface" must not
  // create a redundant "Agent Interface/Agent Interface" nest (and this also
  // hard-stops the runaway re-nesting that previously happened).
  const segments = project.name.split('/')
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => s !== ROOT_FOLDER_NAME)
  if (segments.length === 0) return rootId

  if (segments.length === 1 && project?.storage_folder_id) return project.storage_folder_id

  let parent = rootId
  let topFolderId = null
  for (let i = 0; i < segments.length; i++) {
    const id = await findOrCreateFolder(session, segments[i], parent)
    if (i === 0) topFolderId = id
    parent = id
  }

  if (project?.id && topFolderId) {
    try {
      await supabase.from('projects')
        .update({ storage_folder_id: topFolderId, storage_provider: 'google_drive' })
        .eq('id', project.id)
    } catch {}
  }

  return parent
}

async function uploadFile(session, parentId, filename, mimeType, body) {
  const boundary = '----agentinterface' + Math.random().toString(36).slice(2)
  const metadata = JSON.stringify({ name: filename, parents: [parentId], mimeType })

  let bodyB64
  if (body instanceof Blob) {
    const buf = await body.arrayBuffer()
    bodyB64 = arrayBufferToBase64(buf)
  } else if (typeof body === 'string' && body.startsWith('data:')) {
    bodyB64 = body.split(',')[1]
  } else if (typeof body === 'string') {
    bodyB64 = btoa(unescape(encodeURIComponent(body)))
  } else {
    throw new Error('unsupported_body_type')
  }

  const multipartBody =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    metadata + `\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n` +
    bodyB64 + `\r\n` +
    `--${boundary}--`

  const res = await session.driveFetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipartBody,
    }
  )
  if (!res.ok) throw new Error(`drive_upload_failed_${res.status}`)
  return res.json()
}

/**
 * Save any tool output to the user's Google Drive.
 */
export async function saveToDrive(output, project = null) {
  try {
    const session = await openDriveSession()
    if (!session) return null

    let mimeType = 'application/octet-stream'
    let ext = 'bin'
    if (output.type === 'image') { mimeType = 'image/png'; ext = 'png' }
    if (output.type === 'audio') { mimeType = 'audio/mpeg'; ext = 'mp3' }
    if (output.type === 'video') { mimeType = 'video/mp4'; ext = 'mp4' }
    if (output.type === 'document') {
      const fn = output.filename || ''
      if (fn.endsWith('.pptx')) { mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'; ext = 'pptx' }
      else if (fn.endsWith('.docx')) { mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; ext = 'docx' }
      else if (fn.endsWith('.pdf')) { mimeType = 'application/pdf'; ext = 'pdf' }
      else if (fn.endsWith('.json')) { mimeType = 'application/json'; ext = 'json' }
      else if (fn.endsWith('.txt') || fn.endsWith('.md')) { mimeType = 'text/plain'; ext = fn.endsWith('.md') ? 'md' : 'txt' }
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

    const rootId = await ensureRootFolder(session)
    const folderId = project ? await ensureProjectFolder(session, rootId, project) : rootId
    const folderLink = `https://drive.google.com/drive/folders/${folderId}`

    const safePrompt = (output.prompt || output.tool || 'output').replace(/[^a-z0-9-_ ]/gi, '').slice(0, 60).trim() || 'output'
    const filename = `${Date.now()}-${output.tool}-${safePrompt}.${ext}`
    const file = await uploadFile(session, folderId, filename, mimeType, body)

    if (project?.id) {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          await supabase.from('project_files').insert({
            project_id: project.id,
            user_id: user.id,
            name: filename,
            file_type: output.type,
            storage_url: file.webViewLink,
            storage_file_id: file.id,
            generated_by: output.tool,
            prompt_used: output.prompt?.slice(0, 1000) || null,
          })
        }
      } catch (e) {
        logError('project_files.insert', e)
      }
    }

    return { id: file.id, webViewLink: file.webViewLink, folderId, folderLink }
  } catch (e) {
    if (/_401$/.test(e.message || '')) {
      // Token rejected by Google even after refresh — wipe so UI re-prompts
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          await supabase.from('storage_connections')
            .delete()
            .eq('user_id', user.id)
            .eq('provider', 'google_drive')
        }
      } catch {}
      e.driveAuthExpired = true
    }
    logError('saveToDrive', e, { tool: output?.tool, type: output?.type })
    return null
  }
}
