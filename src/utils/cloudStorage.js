import { supabase } from './supabase'
import { saveToDrive } from './driveStorage'
import { saveToDropbox } from './dropboxStorage'

/**
 * Provider-agnostic save entry point. Picks the user's chosen primary
 * storage (set in Settings → Storage) and routes the output there.
 *
 * Selection order:
 *  1. user_settings.primary_storage_provider (if set + still connected)
 *  2. Whichever provider has an active connection (Drive first, Dropbox)
 *  3. null — no storage connected, output stays in the chat only
 *
 * This is the only function the rest of the app should call. Driver-
 * specific saves (saveToDrive/saveToDropbox) remain available for
 * direct use but normal flow goes through here.
 *
 * Returns { id, webViewLink, provider } on success, null otherwise.
 */
export async function saveToCloud(output, project = null) {
  const provider = await pickProvider()
  if (!provider) return null

  let result = null
  if (provider === 'google_drive') {
    result = await saveToDrive(output, project)
  } else if (provider === 'dropbox') {
    result = await saveToDropbox(output, project)
  }
  return result ? { ...result, provider } : null
}

/**
 * Returns which provider should be used for new saves.
 * Considers primary_storage_provider preference, then falls back to
 * whichever connection exists.
 */
export async function pickProvider() {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const [{ data: settings }, { data: conns }] = await Promise.all([
      supabase.from('user_settings').select('primary_storage_provider').eq('user_id', user.id).maybeSingle(),
      supabase.rpc('get_storage_connections'),
    ])

    const connectedProviders = (conns || []).filter(c => c.access_token).map(c => c.provider)
    if (connectedProviders.length === 0) return null

    const preferred = settings?.primary_storage_provider
    if (preferred && connectedProviders.includes(preferred)) return preferred

    // Fallback order: Drive first, then Dropbox
    if (connectedProviders.includes('google_drive')) return 'google_drive'
    if (connectedProviders.includes('dropbox')) return 'dropbox'
    return connectedProviders[0]
  } catch {
    return null
  }
}

/**
 * List the storage providers the user actually has connected (those with a
 * live access_token), e.g. ['google_drive'] or ['google_drive','dropbox'].
 * Used by the suggested-prompts gap-fillers ("Connect Drive…"). Never throws.
 */
export async function listStorageConnections() {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []
    const { data: conns } = await supabase.rpc('get_storage_connections')
    return (conns || []).filter(c => c.access_token).map(c => c.provider)
  } catch {
    return []
  }
}

export async function setPrimaryProvider(provider) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { error } = await supabase.from('user_settings')
    .upsert({ user_id: user.id, primary_storage_provider: provider, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  return !error
}
