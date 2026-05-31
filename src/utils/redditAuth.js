import { supabase } from './supabase'
import { logError } from './telemetry'
import { arrayBufferToBase64 } from './base64'

/**
 * Reddit OAuth — mirrors the Dropbox flow (manual, not a Supabase provider).
 *
 * Auth model: OAuth2 with PKCE against Reddit, registered as an "installed app"
 * so there is NO client secret — only a public client_id (VITE_REDDIT_CLIENT_ID).
 * Reddit's token + submit endpoints don't allow browser CORS, so those calls go
 * through the Cloudflare Worker (/reddit_token, /reddit_refresh, /reddit_submit).
 * The Worker only forwards — it stores no Reddit credentials.
 *
 * Tokens land in storage_connections (provider='reddit'); reddit_post and
 * getValidRedditToken() pick them up. Access tokens last ~1h; we refresh with
 * the stored refresh_token (granted by duration=permanent).
 */

const PROXY = import.meta.env.VITE_PROXY_URL || 'https://claude-proxy.jamesreed.workers.dev'
const REDDIT_CLIENT_ID = import.meta.env.VITE_REDDIT_CLIENT_ID || ''
const SCOPES = 'identity submit'

export const redditConfigured = () => !!REDDIT_CLIENT_ID

function randomString(len = 64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  const arr = new Uint8Array(len)
  crypto.getRandomValues(arr)
  for (let i = 0; i < len; i++) s += chars[arr[i] % chars.length]
  return s
}

async function sha256base64url(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return arrayBufferToBase64(buf)
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function authHeader() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { 'x-supabase-auth': `Bearer ${session.access_token}` } : {}
}

const redirectUri = () => `${window.location.origin}${window.location.pathname}`

/** Kick off Reddit OAuth — redirects the browser to Reddit's authorize page. */
export async function startRedditAuth() {
  if (!REDDIT_CLIENT_ID) throw new Error('reddit_not_configured')
  const verifier = randomString(64)
  const challenge = await sha256base64url(verifier)
  const state = 'reddit_' + randomString(16)
  sessionStorage.setItem('reddit_pkce_verifier', verifier)
  sessionStorage.setItem('reddit_state', state)

  const url = new URL('https://www.reddit.com/api/v1/authorize')
  url.searchParams.set('client_id', REDDIT_CLIENT_ID)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', state)
  url.searchParams.set('redirect_uri', redirectUri())
  url.searchParams.set('duration', 'permanent')   // get a refresh_token
  url.searchParams.set('scope', SCOPES)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  window.location.assign(url.toString())
}

/**
 * Run on app load. If the URL carries a Reddit ?code=…&state=reddit_…, exchange
 * it (via the Worker) and persist tokens. Returns true if it handled a callback.
 */
export async function finishRedditAuth() {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const state = params.get('state')
  if (!code || !state || !state.startsWith('reddit_')) return false

  const savedState = sessionStorage.getItem('reddit_state')
  const verifier = sessionStorage.getItem('reddit_pkce_verifier')
  if (!savedState || state !== savedState || !verifier) return false
  sessionStorage.removeItem('reddit_state')
  sessionStorage.removeItem('reddit_pkce_verifier')

  try {
    const res = await fetch(`${PROXY}/reddit_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ client_id: REDDIT_CLIENT_ID, code, code_verifier: verifier, redirect_uri: redirectUri() }),
    })
    if (!res.ok) { logError('reddit_token_exchange', new Error(`status_${res.status}`)); return false }
    const json = await res.json()
    if (!json.access_token) return false

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false
    const expiresAt = json.expires_in ? new Date(Date.now() + json.expires_in * 1000).toISOString() : null
    await supabase.from('storage_connections').upsert({
      user_id: user.id,
      provider: 'reddit',
      access_token: json.access_token,
      refresh_token: json.refresh_token || null,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,provider' })

    window.history.replaceState({}, '', window.location.origin + window.location.pathname)
    return true
  } catch (e) {
    logError('finishRedditAuth', e)
    return false
  }
}

/** Returns a valid Reddit access token (refreshing if near expiry) or null. */
export async function getValidRedditToken() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('storage_connections')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', user.id)
    .eq('provider', 'reddit')
    .maybeSingle()
  if (!data?.access_token) return null

  const expiresAt = data.expires_at ? new Date(data.expires_at) : null
  const needsRefresh = !expiresAt || expiresAt < new Date(Date.now() + 60 * 1000)
  if (needsRefresh && data.refresh_token) {
    try {
      const res = await fetch(`${PROXY}/reddit_refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ client_id: REDDIT_CLIENT_ID, refresh_token: data.refresh_token }),
      })
      if (res.ok) {
        const json = await res.json()
        if (json.access_token) {
          const newExpiry = json.expires_in ? new Date(Date.now() + json.expires_in * 1000).toISOString() : null
          await supabase.from('storage_connections')
            .update({ access_token: json.access_token, expires_at: newExpiry, updated_at: new Date().toISOString() })
            .eq('user_id', user.id).eq('provider', 'reddit')
          return json.access_token
        }
      }
    } catch (e) {
      logError('reddit_refresh', e)
    }
  }
  return data.access_token
}
