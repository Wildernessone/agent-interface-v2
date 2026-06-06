// Shared helpers for the authed E2E specs.

// True when the signed-in account has at least one provider (agent) connected.
// The composer's "To" row renders one chip per connected agent plus the
// always-present "All" — so >1 chip means a BYOK key is set. Tests that need a
// live model (send, build, suggestions, voice mid-response) skip when this is
// false, so the suite is green on a key-less account and fully exercised once a
// key is added in Settings → Agents.
export async function agentConnected(page) {
  return (await page.locator('.ai-targets .ai-chip').count()) > 1
}

export const NO_AGENT_SKIP =
  'test account has no BYOK provider key connected — add one in Settings → Agents to run this'
