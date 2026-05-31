// Cross-product analytics beacon → the HUB Supabase project (jcmkoooivghwrgezxode).
//
// Fire-and-forget POST into the public `analytics_events` firehose so the
// Command Center can show traffic / logins / feature use for this product.
// The hub publishable key is public by design — the security boundary is RLS:
// anon may only INSERT (product required); SELECT is admin-only and all
// cross-user aggregation happens server-side in admin_dashboard().
//
// This is intentionally separate from logUsage() in telemetry.js, which writes
// the rich `usage_events` rows to THIS app's own DB. The beacon only emits
// lightweight product-level signals to the shared hub.

const HUB_URL = 'https://jcmkoooivghwrgezxode.supabase.co'
const HUB_KEY = 'sb_publishable_2n0PtcQvGYyndgwlmG0sZQ_ZZSJla_S'
const PRODUCT = 'agent-interface'

const newId = () => {
  try { return crypto.randomUUID() } catch { return `${Date.now()}-${Math.random().toString(16).slice(2)}` }
}

function persistentId(storage, key) {
  try {
    let v = storage.getItem(key)
    if (!v) { v = newId(); storage.setItem(key, v) }
    return v
  } catch { return null }
}
const anonId = () => persistentId(localStorage, 'cc_anon_id')          // stable per browser
const sessionId = () => persistentId(sessionStorage, 'cc_session_id')  // per tab session

let currentUserId = null
export function setTrackUser(id) { currentUserId = id || null }

export function track(eventType, props = {}) {
  try {
    const body = {
      product: PRODUCT,
      event_type: eventType,
      anon_id: anonId(),
      session_id: sessionId(),
      path: location.pathname,
      props,
      ua: navigator.userAgent,
    }
    if (currentUserId) body.user_id = currentUserId
    fetch(`${HUB_URL}/rest/v1/analytics_events`, {
      method: 'POST',
      headers: { apikey: HUB_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* analytics must never break the app */
  }
}

// session_start — once per tab session.
export function trackSessionStart() {
  try {
    if (sessionStorage.getItem('cc_session_started')) return
    sessionStorage.setItem('cc_session_started', '1')
  } catch { /* ignore */ }
  track('session_start')
}

// login — once per tab session (covers both email and OAuth sign-ins, which
// land via onAuthStateChange 'SIGNED_IN' after a redirect).
export function trackLogin() {
  try {
    if (sessionStorage.getItem('cc_logged_in')) return
    sessionStorage.setItem('cc_logged_in', '1')
  } catch { /* ignore */ }
  track('login')
}
