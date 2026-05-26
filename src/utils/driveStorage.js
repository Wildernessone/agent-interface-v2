import { supabase } from './supabase'
import { logError } from './telemetry'

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

  const { error } = await supabase.from('storage_connections').upsert({
    user_id: user.id,
    provider: 'google_drive',
    access_token: accessToken,
    refresh_token: refreshToken || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,provider' })

  if (error) logError('captureDriveTokens', error)
  return !error
}

async function getDriveToken() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('storage_connections')
    .select('access_token, root_folder_id')
    .eq('user_id', user.id)
    .eq('provider', 'google_drive')
    .maybeSingle()
  return data
}

async function findOrCreateFolder(token, name, parentId = null) {
  const parentClause = parentId ? ` and '${parentId}' in parents` : ""
  const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentClause}`
  const search = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!search.ok) throw new Error(`drive_search_failed_${search.status}`)
  const data = await search.json()
  if (data.files?.[0]?.id) return data.files[0].id

  const body = { name, mimeType: "application/vnd.google-apps.folder" }
  if (parentId) body.parents = [parentId]
  const create = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!create.ok) throw new Error(`drive_create_folder_failed_${create.status}`)
  const folder = await create.json()
  return folder.id
}

async function ensureRootFolder(token) {
  return findOrCreateFolder(token, "Agent Interface")
}

async function ensureProjectFolder(token, rootId, project) {
  // Cached path: if project already has storage_folder_id, use it
  if (project?.storage_folder_id) return project.storage_folder_id
  if (!project?.name) return rootId

  const folderId = await findOrCreateFolder(token, project.name, rootId)

  // Cache the folder id back to the project row
  try {
    await supabase.from('projects')
      .update({ storage_folder_id: folderId, storage_provider: 'google_drive' })
      .eq('id', project.id)
  } catch {}

  return folderId
}

async function uploadFile(token, parentId, filename, mimeType, body) {
  // Resumable would be nicer, but multipart is simpler for small/medium files.
  const boundary = "----agentinterface" + Math.random().toString(36).slice(2)
  const metadata = JSON.stringify({ name: filename, parents: [parentId], mimeType })

  // Convert body to base64 if it's a Blob/ArrayBuffer
  let bodyB64
  if (body instanceof Blob) {
    const buf = await body.arrayBuffer()
    bodyB64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
  } else if (typeof body === "string" && body.startsWith("data:")) {
    bodyB64 = body.split(",")[1]
  } else if (typeof body === "string") {
    bodyB64 = btoa(unescape(encodeURIComponent(body)))
  } else {
    throw new Error("unsupported_body_type")
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

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}`, Authorization: `Bearer ${token}` },
      body: multipartBody,
    }
  )
  if (!res.ok) throw new Error(`drive_upload_failed_${res.status}`)
  return res.json()
}

/**
 * Save any tool output to the user's Google Drive.
 * If a project is provided, saves into "Agent Interface > <Project Name>/".
 * Otherwise saves into the flat "Agent Interface" folder.
 * Also writes a row in project_files when a project is provided.
 *
 * @param {{ url?: string, type: string, tool: string, prompt?: string }} output
 * @param {Object} [project] — optional active project row
 */
export async function saveToDrive(output, project = null) {
  try {
    const conn = await getDriveToken()
    if (!conn?.access_token) return null
    const token = conn.access_token

    let mimeType = 'application/octet-stream'
    let ext = 'bin'
    if (output.type === 'image') { mimeType = 'image/png'; ext = 'png' }
    if (output.type === 'audio') { mimeType = 'audio/mpeg'; ext = 'mp3' }
    if (output.type === 'video') { mimeType = 'video/mp4'; ext = 'mp4' }

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

    const rootId = await ensureRootFolder(token)
    const folderId = project ? await ensureProjectFolder(token, rootId, project) : rootId

    const safePrompt = (output.prompt || output.tool || 'output').replace(/[^a-z0-9-_ ]/gi, '').slice(0, 60).trim() || 'output'
    const filename = `${Date.now()}-${output.tool}-${safePrompt}.${ext}`
    const file = await uploadFile(token, folderId, filename, mimeType, body)

    // Track the file row in project_files if a project context exists
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

    return { id: file.id, webViewLink: file.webViewLink }
  } catch (e) {
    logError('saveToDrive', e, { tool: output?.tool, type: output?.type })
    return null
  }
}
