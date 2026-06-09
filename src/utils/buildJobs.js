// Server-side builds — PHASE 1 client: persist each build + its finished
// deliverable BYTES so a tab close/reload never loses generated work (and
// storage-less users keep their files). Best-effort throughout: a persistence
// failure must never break or block the build itself, so every call swallows
// its own errors and degrades to the old in-memory-only behavior.
import { supabase } from './supabase'

const BUCKET = 'build-deliverables'
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
