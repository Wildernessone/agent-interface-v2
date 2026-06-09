// Server-side builds — PHASE 1 client: persist each build + its finished
// deliverable BYTES so a tab close/reload never loses generated work (and
// storage-less users keep their files). Best-effort throughout: a persistence
// failure must never break or block the build itself, so every call swallows
// its own errors and degrades to the old in-memory-only behavior.
import { supabase } from './supabase'

const BUCKET = 'build-deliverables'
const PROXY = import.meta.env.VITE_PROXY_URL || 'https://claude-proxy.jamesreed.workers.dev'
// Server-side execution (Phase 2) is OFF until the BuildRunner Durable Object is
// deployed (wrangler deploy) — flip VITE_SERVER_BUILDS=1 in the Pages env then.
// Until then, and on ANY server-path error, builds run client-side as before.
export const SERVER_BUILDS_ENABLED = import.meta.env.VITE_SERVER_BUILDS === '1'
// 7-day signed URLs — long enough to be useful in chat, short enough that a
// leaked link expires. Regenerated on every conversation load.
const SIGNED_TTL = 60 * 60 * 24 * 7

async function urlToBlob(url) {
  if (!url) return null
  try { return await (await fetch(url)).blob() } catch { return null }  // fetch handles data: and blob:
}

export async function createBuildJob({ conversationId, turnId, deliverable, request }) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const { data, error } = await supabase.from('build_jobs').insert({
      user_id: user.id,
      conversation_id: conversationId || null,
      turn_id: turnId || null,
      status: 'running',
      deliverable: deliverable || null,
      request: String(request || '').slice(0, 2000),
    }).select('id').single()
    if (error) { console.warn('[buildJobs] create failed:', error.message); return null }
    return data?.id || null
  } catch (e) { console.warn('[buildJobs] create threw:', e?.message); return null }
}

// Upload one deliverable's bytes to <uid>/<jobId>/<filename>. Returns the storage
// path, or null if there's nothing to upload / it failed.
export async function uploadDeliverable(jobId, output) {
  try {
    if (!jobId || !output?.url) return null
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const blob = await urlToBlob(output.url)
    if (!blob || blob.size === 0) return null
    const safe = String(output.filename || 'file').replace(/[^a-z0-9._-]/gi, '_').slice(0, 80) || 'file'
    const path = `${user.id}/${jobId}/${safe}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
      contentType: blob.type || 'application/octet-stream', upsert: true,
    })
    if (error) { console.warn('[buildJobs] upload failed:', error.message); return null }
    return path
  } catch (e) { console.warn('[buildJobs] upload threw:', e?.message); return null }
}

export async function finishBuildJob(jobId, { files, errors, status } = {}) {
  try {
    if (!jobId) return
    await supabase.from('build_jobs').update({
      status: status || 'done',
      files: files || [],
      errors: errors || [],
      updated_at: new Date().toISOString(),
    }).eq('id', jobId)
  } catch (e) { console.warn('[buildJobs] finish threw:', e?.message) }
}

export async function signedUrlFor(storagePath, expiresIn = SIGNED_TTL) {
  try {
    if (!storagePath) return null
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, expiresIn)
    if (error) return null
    return data?.signedUrl || null
  } catch { return null }
}

// Recent build jobs for a conversation (newest first), used to rehydrate finished
// deliverables after a reload — at which point the in-memory data: URLs are gone.
export async function loadConversationBuildJobs(conversationId) {
  try {
    if (!conversationId) return []
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []
    const { data } = await supabase.from('build_jobs')
      .select('*').eq('user_id', user.id).eq('conversation_id', conversationId)
      .order('created_at', { ascending: false }).limit(20)
    return data || []
  } catch { return [] }
}

// Run a build on the SERVER (the BuildRunner Durable Object) and poll the job row
// until it finishes. Returns the same { files, errors } shape the client builder
// returns, with signed-URL outputs. Throws on kickoff failure/timeout so the caller
// can fall back to a client-side build. Server-eligible = string-output builds only.
export async function runServerBuild({ jobId, request, context, brandContext, model, deliverable, anthropicKey, authHeaders }, onPoll = () => {}) {
  const res = await fetch(`${PROXY}/build/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, ...(authHeaders || {}) },
    body: JSON.stringify({ jobId, request, context, brandContext, model, deliverable }),
  })
  if (!res.ok) throw new Error(`server_build_kickoff_${res.status}`)
  for (let i = 0; i < 150; i++) {            // ~5 min ceiling
    await new Promise(r => setTimeout(r, 2000))
    const { data } = await supabase.from('build_jobs').select('status,files,errors').eq('id', jobId).single()
    if (!data) continue
    onPoll(data)
    if (data.status === 'done' || data.status === 'failed') {
      const files = []
      for (const jf of (data.files || [])) {
        const url = jf.storagePath ? await signedUrlFor(jf.storagePath) : null
        if (!url && !jf.savedLink) continue
        files.push({ stepId: jf.label || 'File', label: jf.label || 'File', component: !!jf.component,
          savedLink: jf.savedLink || null,
          output: { type: jf.type || null, filename: jf.filename || null, url: url || undefined, tool: 'build' },
          unsaved: !jf.savedLink && !!url })
      }
      return { files, errors: data.errors || [], status: data.status, serverBuilt: true }
    }
  }
  throw new Error('server_build_timeout')
}

// Persist a finished build's deliverables. Cloud-saved files (Drive/Dropbox) keep
// their durable savedLink; everything else (the unsaved data: URLs that get
// stripped on reload) is uploaded to Storage. Returns the job's file records.
export async function persistDeliverables(jobId, files = []) {
  const out = []
  for (const f of files) {
    const rec = {
      label: f.label || f.stepId || 'File',
      type: f.output?.type || null,
      filename: f.output?.filename || null,
      component: !!f.component,
      savedLink: f.savedLink || null,
      storagePath: null,
    }
    if (!rec.savedLink && f.output?.url) rec.storagePath = await uploadDeliverable(jobId, f.output)
    out.push(rec)
  }
  return out
}
