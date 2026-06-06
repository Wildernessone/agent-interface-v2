// Shared helpers for the authed E2E specs.

// True when the signed-in account has at least one provider (agent) connected.
// The composer's "To" row renders one chip per connected agent plus the
// always-present "All" — so >1 chip means a BYOK key is set. Tests that need a
// live model (send, build, suggestions, voice mid-response) skip when this is
// false, so the suite is green on a key-less account and fully exercised once a
// key is added in Settings → Agents.
export async function agentConnected(page) {
  // Settings (agents + keys) load asynchronously AFTER the composer mounts, so
  // the per-agent target chips appear a beat later than `.ai-composer`. Wait
  // briefly for an agent chip — the 2nd `.ai-chip`, after the always-present
  // "All" — before deciding, otherwise we race the load and wrongly conclude
  // "no agents". No chip within the window → genuinely key-less → skip.
  try {
    await page.locator('.ai-targets .ai-chip').nth(1).waitFor({ state: 'visible', timeout: 10_000 })
    return true
  } catch {
    return false
  }
}

export const NO_AGENT_SKIP =
  'test account has no BYOK provider key connected — add one in Settings → Agents to run this'
