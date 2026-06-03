// ─────────────────────────────────────────────────────────────
// PROVIDER-CALL TIMEOUTS
//
// Every call to the proxy (agent turns, the orchestrate decision, the V2
// audit) used a bare fetch with no abort. A hung socket/proxy therefore left
// the operation spinning FOREVER with no error — the same hang class that
// froze build steps until agent_synth got a 90s ceiling. This wraps those
// calls so a stall surfaces as an error instead of limbo.
//
// IDLE-based, not a fixed deadline: the timer resets every time bytes arrive
// (bump()), so a long-but-progressing stream is never cut off — only a true
// stall (no data for the window) aborts.
// ─────────────────────────────────────────────────────────────

export const PROVIDER_IDLE_TIMEOUT_MS = 90_000

export function makeIdleTimeout(ms = PROVIDER_IDLE_TIMEOUT_MS) {
  const ctrl = new AbortController()
  let timer = setTimeout(() => ctrl.abort(), ms)
  return {
    signal: ctrl.signal,
    // Call when bytes arrive (or before a retry) to reset the idle window.
    bump() { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(), ms) },
    // Always call when the operation settles, so a stray 90s timer can't keep
    // the timer (or a test's Node process) alive.
    clear() { clearTimeout(timer) },
  }
}

export function isAbort(e) {
  return e?.name === 'AbortError' || /aborted/i.test(e?.message || '')
}
