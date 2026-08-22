// Weekly refresh, 2026-08-22. Refines 'agent-plugins': a 1.1.0 file now sits in the spec
// repo, but it is a Working Draft — undated, and with no changelog saying what moved from
// 1.0.0. That distinction is the whole point of recording it: the format is still being
// worked, and anyone deciding whether to build on it should know 1.0.0 is not the end state.
//
// Checked and NOT changed this week: 'mcp'. The entry already names revision 2026-07-28,
// sessions removed, Extensions/MCP Apps/Tasks formalized and the 12-month deprecation
// policy, all of which match modelcontextprotocol.io/specification/versioning as read today.
// No changeset for it — an accurate entry needs no edit. See CLAUDE.md.
//
// ⚠ Scope: 3 of 25 entries were verified this week (mcp, agent-plugins, a2a-by-inspection).
// The other 22 were NOT re-checked and keep their 2026-08-10 date. Do not read this file as
// a full sweep.

export const checked = '2026-08-22'

export const entries = [
  {
    id: 'agent-plugins', group: 'protocol', name: 'Agent Plugins',
    steward: 'Technical Steering Committee (no foundation): Amazon, Cursor/Anysphere, Google, Microsoft, OpenAI, Vercel; proposed by Vercel',
    short: 'A shared package format for bundling Agent Skills and MCP servers into one directory — plugin.json, skills/, mcp.json — readable by ChatGPT, Codex, Cursor, GitHub Copilot, Kiro and VS Code. v1.0.0 shipped Aug 6, 2026; Google joined as a sixth core maintainer the same day. A 1.1.0 file has since appeared in the spec repo, marked Working Draft.',
    call: 'Real convergence on a real annoyance — one plugin directory instead of six. The 1.1.0 draft says the format is still moving: it carries no publication date and no changelog against 1.0.0, so build against 1.0.0 and expect churn. The original reservations stand — it packages two specs Anthropic wrote (MCP and Agent Skills) without Anthropic on the steering committee or Claude Code among the launch clients, neither of which appears anywhere in the 1.1.0 draft either, and it still punts on install, trust and permission semantics. Governance runs on a company-staffed TSC with no neutral foundation behind it, unlike MCP or A2A.',
    status: 'early', statusLabel: 'Early',
    links: [['Spec 1.0.0', 'https://github.com/agentplugins/agent-plugins-spec/blob/main/spec/1.0.0.md'], ['Spec 1.1.0 (working draft)', 'https://github.com/agentplugins/agent-plugins-spec/blob/main/spec/1.1.0.md'], ['Governance', 'https://github.com/agentplugins/agent-plugins-spec/blob/main/GOVERNANCE.md'], ['Vercel announcement', 'https://vercel.com/blog/introducing-agent-plugins'], ['Google joins as core maintainer', 'https://developers.googleblog.com/agent-plugins-package-your-skills-tools-and-more/'], ['Claude Code plugin format (for comparison)', 'https://code.claude.com/docs/en/plugins']],
  },
]
