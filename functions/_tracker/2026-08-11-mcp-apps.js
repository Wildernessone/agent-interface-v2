// Changeset: MCP Apps became one of MCP's first two official Extensions in
// the 2026-07-28 spec, with a real client list behind it. See CLAUDE.md for
// how changesets fold into the tracker.

export const checked = '2026-08-11'

export const entries = [
  {
    id: 'mcp-apps', group: 'protocol', name: 'MCP Apps',
    steward: 'MCP-UI community, built with engineers from OpenAI and Anthropic; formalized under the Agentic AI Foundation',
    short: 'Extension bringing interactive HTML UI into MCP itself: a server predeclares a ui:// resource, a tool links to it, and the host renders it in a sandboxed iframe. Became one of MCP’s first two official Extensions in the 2026-07-28 spec.',
    call: 'Moved fast — proposed by MCP-UI in Nov 2025, launched with real client support Jan 26 2026 (Claude web/desktop, ChatGPT, Goose, VS Code Insiders; Microsoft, JetBrains, AWS and Google DeepMind committed), then folded into the formal spec as an inaugural Extension on 2026-07-28. If it lands broadly, the tool layer and the frontend layer start merging — squeezing standalone frontend protocols like AG-UI, whose whole job is that seam. Security researchers are already flagging a trust-inversion problem: installing an MCP server now also installs whatever UI it renders, without the per-site trust decisions a browser gives you. Build on it, but audit which servers you let render.',
    status: 'rising', statusLabel: 'Rising',
    links: [['2026-07-28 Extensions announcement', 'https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/'], ['Jan 2026 launch & client list', 'https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/'], ['Original Nov 2025 proposal', 'https://blog.modelcontextprotocol.io/posts/2025-11-21-mcp-apps/'], ['Security: the trust-inversion problem', 'https://www.backslash.security/blog/new-mcp-spec-opens-new-attack-surfaces']],
  },
]
