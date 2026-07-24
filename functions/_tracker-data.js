// The tracker's data. Versioned in git — every substantive edit bumps
// TRACKER_UPDATED (freshness is a measured citation factor; a stale date is
// worse than none). Rules for entries:
//   - Every factual claim (steward, version, date, status) traces to a source
//     link in `links`. If it can't be sourced, it doesn't ship.
//   - `call` is our editorial one-liner — dated judgment, plainly worded.
//   - The graveyard is first-class. Nobody else tracks what died (verified
//     July 2026: no neutral alive/dead/merged tracker exists) — that's the
//     niche. Churn is brutal here: three major agent surfaces died within a
//     year of launch.
// Statuses: live | rising | early | watch | dead

export const TRACKER_UPDATED = '2026-07-24'

export const TRACKER = [
  // ── Protocols: the agent ↔ software layer ──────────────────────────────
  {
    id: 'mcp', group: 'protocol', name: 'MCP — Model Context Protocol',
    steward: 'Agentic AI Foundation (Linux Foundation); created at Anthropic',
    short: 'The standard connector between an agent and its tools and data, JSON-RPC based. Current spec revision 2025-11-25; the next revision has a release candidate out.',
    call: 'The settled winner of the agent-to-tool layer. OpenAI, Google and Microsoft all adopted it in 2025; it was donated to the Linux Foundation’s Agentic AI Foundation in Dec 2025, and the official registry passed ~9,600 servers. Build on it without hesitation.',
    status: 'live', statusLabel: 'Established',
    links: [['Spec & docs', 'https://modelcontextprotocol.io'], ['Versioning', 'https://modelcontextprotocol.io/specification/versioning'], ['Official registry', 'https://registry.modelcontextprotocol.io'], ['AAIF donation', 'https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation']],
  },
  {
    id: 'a2a', group: 'protocol', name: 'A2A — Agent2Agent',
    steward: 'Linux Foundation (TSC: AWS, Cisco, Google, IBM, Microsoft, Salesforce, SAP, ServiceNow); created at Google',
    short: 'Agent-to-agent interop: discovery via Agent Cards, task delegation, long-running exchanges. v1.0.1 shipped May 2026.',
    call: 'The agent-to-agent layer has a winner too — 150+ supporting orgs, shipping in Azure AI Foundry and AWS Bedrock AgentCore, and it absorbed IBM’s rival ACP outright. v1.0 landed March 2026; safe for interop bets now.',
    status: 'live', statusLabel: 'Established',
    links: [['Spec', 'https://a2a-protocol.org'], ['Releases', 'https://github.com/a2aproject/A2A/releases'], ['One-year adoption', 'https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year']],
  },
  {
    id: 'ag-ui', group: 'protocol', name: 'AG-UI — Agent–User Interaction Protocol',
    steward: 'CopilotKit — the notable foundation holdout',
    short: 'Standardizes the agent-to-frontend seam: ~31 typed event kinds over SSE for streaming, state sync, interrupts, and generative UI.',
    call: 'The most serious attempt at the frontend layer, with real integrations (Microsoft Agent Framework, AWS Bedrock AgentCore, Google ADK) — and it is winning the phrase "agentic UI" in search. Still vendor-stewarded while every peer moved to a foundation; watch governance before betting the stack on it.',
    status: 'rising', statusLabel: 'Rising',
    links: [['Docs', 'https://docs.ag-ui.com/introduction'], ['Project', 'https://github.com/ag-ui-protocol/ag-ui'], ['AWS integration', 'https://aws.amazon.com/blogs/machine-learning/build-generative-ui-for-ai-agents-on-amazon-bedrock-agentcore-with-the-ag-ui-protocol/']],
  },
  {
    id: 'zed-acp', group: 'protocol', name: 'ACP — Agent Client Protocol (Zed)',
    steward: 'Zed Industries',
    short: 'The "LSP for coding agents": a JSON-RPC protocol connecting any editor to any coding agent. Adopted across JetBrains IDEs in late 2025.',
    call: 'Quietly becoming the standard seam between IDEs and coding agents. Terminology trap: unqualified "ACP" now usually means this, not IBM’s dead protocol of the same acronym.',
    status: 'rising', statusLabel: 'Rising',
    links: [['Spec', 'https://agentclientprotocol.com'], ['JetBrains adoption', 'https://blog.jetbrains.com/ai/2025/10/jetbrains-zed-open-interoperability-for-ai-coding-agents-in-your-ide/']],
  },
  {
    id: 'ap2', group: 'protocol', name: 'AP2 — Agent Payments Protocol',
    steward: 'FIDO Alliance (donated by Google, April 2026)',
    short: 'Cryptographically signed mandates so an agent purchase carries durable, auditable proof of what the human approved. v0.2 adds human-not-present payments.',
    call: 'The most interesting approval-UX idea in the stack: consent as a signed artifact instead of a dismissed dialog. 60+ payment players signed on at launch. Early — but this is where agent commerce compliance is heading.',
    status: 'early', statusLabel: 'Early',
    links: [['Spec', 'https://ap2-protocol.org'], ['FIDO donation', 'https://fidoalliance.org/google-donates-agent-payments-protocol-to-fido-alliance/']],
  },
  {
    id: 'x402', group: 'protocol', name: 'x402',
    steward: 'x402 Foundation (Linux Foundation); created at Coinbase',
    short: 'HTTP-native machine payments reviving status code 402: a server quotes terms, the agent pays and retries with proof.',
    call: 'Real volume, not a whitepaper — tens of millions of transactions a month, a Linux Foundation home with Google, Stripe, Visa and Mastercard among governing members, and AWS shipping 402 enforcement in CloudFront. The plumbing for agents that spend.',
    status: 'rising', statusLabel: 'Rising',
    links: [['Site', 'https://www.x402.org'], ['Foundation launch', 'https://www.linuxfoundation.org/press/linux-foundation-is-launching-the-x402-foundation-and-welcoming-the-contribution-of-the-x402-protocol']],
  },
  {
    id: 'mcp-apps', group: 'protocol', name: 'MCP Apps',
    steward: 'MCP community / Agentic AI Foundation',
    short: 'Extension bringing interactive UI into MCP itself — servers ship interface components that render inside MCP clients.',
    call: 'If it lands broadly, the tool layer and the frontend layer start merging — which would squeeze the standalone frontend protocols. Shipping in some clients; early.',
    status: 'early', statusLabel: 'Early',
    links: [['MCP docs', 'https://modelcontextprotocol.io']],
  },
  {
    id: 'openai-apps', group: 'protocol', name: 'OpenAI Apps SDK',
    steward: 'OpenAI (built on MCP)',
    short: 'Apps that render and act inside ChatGPT — open submissions and an app directory since Dec 2025, shared by ChatGPT and Codex.',
    call: 'Not an open standard, but it ships interface conventions to more users than any spec ever will. Track it as a de-facto force — and note it chose MCP as its base, which tells you who won the tool layer.',
    status: 'rising', statusLabel: 'Rising',
    links: [['Apps SDK', 'https://developers.openai.com/apps-sdk'], ['Open submissions', 'https://openai.com/index/developers-can-now-submit-apps-to-chatgpt/']],
  },
  {
    id: 'computer-use', group: 'protocol', name: 'Computer use (screen-level control)',
    steward: 'Anthropic, OpenAI, others (an approach, not a spec)',
    short: 'The protocol-less path: the agent operates the same screen, cursor, and keyboard a human would. Anthropic’s API has run in beta since Oct 2024.',
    call: 'The universal fallback when no protocol exists, and the hardest to supervise — screen actions have no schema to gate on. It coexists with protocols rather than losing to them; the supervision patterns it forced (watch mode, takeover mode) are spreading.',
    status: 'rising', statusLabel: 'Rising',
    links: [['Anthropic computer use', 'https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool'], ['ChatGPT agent', 'https://openai.com/index/introducing-chatgpt-agent/']],
  },
  {
    id: 'agents-md', group: 'protocol', name: 'AGENTS.md',
    steward: 'Agentic AI Foundation (Linux Foundation); originated at OpenAI',
    short: 'A plain-markdown convention: one file in a repo telling coding agents how to work in that codebase.',
    call: 'Boring, tiny, and already everywhere — the kind of standard that wins by being trivial to adopt. Add one to every repo you own.',
    status: 'rising', statusLabel: 'Rising',
    links: [['AAIF announcement', 'https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation']],
  },
  {
    id: 'llms-txt', group: 'protocol', name: 'llms.txt',
    steward: 'Community convention (proposed by Answer.AI)',
    short: 'A proposed root file giving AI systems a curated map of a site’s content.',
    call: 'Publisher adoption grew ~9x in a year; consumption stayed near zero — a 137k-domain log study found 97% of deployed files never get fetched by an AI bot, and Google compares it to the keywords meta tag. Costs 30 minutes, so ship one. Expect nothing yet.',
    status: 'watch', statusLabel: 'Watch',
    links: [['Proposal', 'https://llmstxt.org'], ['Log-study coverage', 'https://ppc.land/llms-txt-adoption-rises-8-8x-but-97-of-files-get-zero-ai-requests/'], ['Google’s comparison', 'https://www.searchenginejournal.com/google-says-llms-txt-comparable-to-keywords-meta-tag/544804/']],
  },

  // ── The graveyard ──────────────────────────────────────────────────────
  {
    id: 'ibm-acp', group: 'graveyard', name: 'ACP — Agent Communication Protocol (IBM)',
    steward: 'was IBM Research',
    short: 'IBM’s agent-to-agent protocol, launched March 2025.',
    call: 'Merged into A2A August 2025; the repo is archived with a banner saying so. Its acronym was promptly claimed by Zed’s unrelated editor protocol — a trap for anyone reading 2025 coverage today.',
    status: 'dead', statusLabel: 'Merged into A2A',
    links: [['LF announcement', 'https://lfaidata.foundation/communityblog/2025/08/29/acp-joins-forces-with-a2a-under-the-linux-foundations-lf-ai-data/'], ['Archived repo', 'https://github.com/i-am-bee/acp']],
  },
  {
    id: 'operator', group: 'graveyard', name: 'OpenAI Operator',
    steward: 'was OpenAI',
    short: 'The standalone computer-use agent product, launched January 2025.',
    call: 'Lived seven months: merged into ChatGPT agent in July 2025, site shut that August. The capability survived; the standalone surface didn’t — a pattern that keeps repeating.',
    status: 'dead', statusLabel: 'Absorbed',
    links: [['ChatGPT agent announcement', 'https://openai.com/index/introducing-chatgpt-agent/']],
  },
  {
    id: 'atlas', group: 'graveyard', name: 'ChatGPT Atlas',
    steward: 'was OpenAI',
    short: 'OpenAI’s standalone agentic browser, launched October 2025, macOS only.',
    call: 'Discontinued July 2026, dead in under ten months — folded into the ChatGPT desktop app and a Chrome extension. Strong evidence for the thesis that agentic browsing is a feature, not a browser.',
    status: 'dead', statusLabel: 'Discontinued',
    links: [['Launch', 'https://openai.com/index/introducing-chatgpt-atlas/'], ['Shutdown coverage', 'https://9to5mac.com/2026/07/09/openai-is-discontinuing-chatgpt-atlas-its-standalone-desktop-browser/']],
  },
  {
    id: 'agent-builder', group: 'graveyard', name: 'OpenAI AgentKit (Agent Builder & Evals)',
    steward: 'was OpenAI',
    short: 'The visual agent-building suite announced at DevDay, October 2025.',
    call: 'Deprecation notice eight months after launch: the visual builder and evals sunset November 2026; OpenAI points builders back to the code-first SDK. ChatKit survives. Visual agent-building keeps losing to code.',
    status: 'dead', statusLabel: 'Deprecated',
    links: [['Deprecations page', 'https://developers.openai.com/api/docs/deprecations']],
  },
  {
    id: 'agent-protocol', group: 'graveyard', name: 'Agent Protocol (agentprotocol.ai)',
    steward: 'was AI Engineer Foundation',
    short: 'An early attempt at a common agent API, predating the current wave.',
    call: 'Dormant since spring 2025. Being first to a layer guarantees nothing; being adopted does.',
    status: 'dead', statusLabel: 'Dormant',
    links: [['Site', 'https://agentprotocol.ai']],
  },

  // ── Patterns: the human ↔ agent layer ──────────────────────────────────
  {
    id: 'approval-gate', group: 'pattern', name: 'The approval gate',
    steward: 'Convention — no unified standard exists',
    short: 'The agent proposes, a human releases. Five partial standards touch it (MCP elicitation, A2A input-required, AG-UI interrupts, AP2 mandates, OS-level workspaces) — and they don’t compose.',
    call: 'Universal, and universally decaying into click-through where it’s designed lazily. The fragmentation across five protocols is the finding: approval semantics are still product-local in 2026.',
    status: 'live', statusLabel: 'Established',
    links: [['Our guide', '/guides/the-approval-gate-designing-sign-off-that-stays-meaningful'], ['MCP elicitation', 'https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation'], ['Microsoft Design: UX for agents', 'https://microsoft.design/articles/ux-design-for-agents/']],
  },
  {
    id: 'permission-modes', group: 'pattern', name: 'Permission modes (graduated autonomy)',
    steward: 'Convention — converged independently across products',
    short: 'Read-only → suggest → auto-with-gates → scoped full-auto. Coding agents ship it as mode dials plus allow/deny rules plus OS sandboxes; consumer agents as watch/takeover modes.',
    call: 'The closest thing the human layer has to a standard — Claude Code, Codex, Cursor and the consumer agents all landed on recognizably the same ladder without a spec. Sandboxing is displacing per-action prompting at the bottom rung.',
    status: 'live', statusLabel: 'Established',
    links: [['Our guide', '/guides/permission-modes-graduated-autonomy-for-ai-agents'], ['Claude Code permission modes', 'https://code.claude.com/docs/en/permission-modes'], ['Codex approvals', 'https://developers.openai.com/codex/agent-approvals-security']],
  },
  {
    id: 'interrupt-resume', group: 'pattern', name: 'Interrupt / resume with durable state',
    steward: 'Convention; several protocols carry a wire format',
    short: 'The agent parks mid-task on a serializable pause and resumes when the human answers — seconds or days later. LangGraph’s interrupt(), A2A’s input-required state, AG-UI’s interrupt outcome.',
    call: 'The framework layer’s consensus answer to human-in-the-loop, formalized across the 1.0 releases of late 2025. If your agent can’t checkpoint a pause, you don’t have an approval gate — you have a modal.',
    status: 'rising', statusLabel: 'Rising',
    links: [['LangGraph interrupts', 'https://docs.langchain.com/oss/python/langgraph/interrupts'], ['A2A task states', 'https://a2a-protocol.org/latest/specification/']],
  },
  {
    id: 'streaming-progress', group: 'pattern', name: 'Streaming progress & the live run view',
    steward: 'Convention; AG-UI standardizes the wire format',
    short: 'A long-running agent narrates decision-level progress so a human can interrupt before the consequence, not after. Consumer agents add a watch-the-desktop view.',
    call: 'Every serious agent surface streams now. The open question is grain: too fine is noise, too coarse defeats the point.',
    status: 'rising', statusLabel: 'Rising',
    links: [['AG-UI docs', 'https://docs.ag-ui.com/introduction'], ['ChatGPT agent’s live view', 'https://openai.com/index/introducing-chatgpt-agent/']],
  },
  {
    id: 'audit-trail', group: 'pattern', name: 'The audit trail & signed consent',
    steward: 'Convention; AP2 makes consent cryptographic',
    short: 'Append-only history of action, predicted consequence, and approver. AP2’s mandates push the idea further: approval as a signed, durable artifact.',
    call: 'Under-built everywhere because it pays off only after an incident. Payments got there first (mandates); enterprise agent governance is following. Build the trail before you need it.',
    status: 'rising', statusLabel: 'Rising',
    links: [['Our guide on gates & trails', '/guides/the-approval-gate-designing-sign-off-that-stays-meaningful'], ['AP2', 'https://ap2-protocol.org']],
  },
  {
    id: 'os-agent-workspaces', group: 'pattern', name: 'OS-level agent workspaces',
    steward: 'Microsoft, Apple (vendor-specific, emerging)',
    short: 'The operating system as the permission boundary: Windows 11’s Agent Workspace runs agents under low-privilege accounts with folder-scoped access; Apple is steering agents through typed App Intents.',
    call: 'The endgame for the bottom of the permission ladder — if the OS holds the sandbox, per-app approval UIs get simpler. Both are early and off by default. Watch.',
    status: 'early', statusLabel: 'Early',
    links: [['Windows agentic features', 'https://support.microsoft.com/en-US/Windows/Ai/Ai-Features/experimental-agentic-features'], ['Apple Intelligence / WWDC26', 'https://developer.apple.com/wwdc26/guides/apple-intelligence/']],
  },
  {
    id: 'handoff', group: 'pattern', name: 'Handoff & escalation',
    steward: 'Convention — no standards body',
    short: 'The agent stops and hands the human a decision with full context, instead of guessing through uncertainty.',
    call: 'The least-designed of the core patterns — most products still hand off by failing. Room for someone to define it well.',
    status: 'early', statusLabel: 'Early',
    links: [['NN/g on AI agents', 'https://www.nngroup.com/topic/ai/']],
  },

  // ── Surfaces: where agents meet users ──────────────────────────────────
  {
    id: 'coding-agents', group: 'surface', name: 'Coding agents',
    steward: '—',
    short: 'Terminal, IDE, and cloud agents doing real software work. The proving ground where most interface patterns were invented.',
    call: 'The most mature agent surface, and still where new supervision UX shows up first — permission modes, checkpoints/rewind, sandbox-over-prompting all debuted here. Watch it to see everyone else’s roadmap.',
    status: 'live', statusLabel: 'Established',
    links: [['Anthropic: building effective agents', 'https://www.anthropic.com/engineering/building-effective-agents'], ['Zed ACP', '/tracker#zed-acp']],
  },
  {
    id: 'agentic-browsers', group: 'surface', name: 'Agentic browsing',
    steward: '—',
    short: 'Agents that navigate, fill, and buy on the consumer web. One standalone browser went mass-market free; one sold for ~$610M; OpenAI’s died in ten months.',
    call: 'The standalone-browser thesis partially failed — the capability is consolidating into existing browsers and chat apps as a feature. The supervision problem remains the hardest anywhere: high-consequence actions on interfaces the agent doesn’t control.',
    status: 'rising', statusLabel: 'Rising',
    links: [['Atlas shutdown', '/tracker#atlas'], ['Comet goes free', 'https://www.cnbc.com/2025/10/02/perplexity-ai-comet-browser-free-.html']],
  },
  {
    id: 'in-chat-apps', group: 'surface', name: 'In-chat app surfaces',
    steward: '—',
    short: 'Apps and tools rendering inside chat products (ChatGPT apps, MCP Apps in clients) — the interface comes to the conversation.',
    call: 'Distribution gravity says this surface grows regardless of which protocol wins it. Design for small, interruptible interactions.',
    status: 'rising', statusLabel: 'Rising',
    links: [['MCP Apps', '/tracker#mcp-apps'], ['OpenAI Apps SDK', '/tracker#openai-apps']],
  },
  {
    id: 'ambient-agents', group: 'surface', name: 'Ambient agents & agent inboxes',
    steward: '—',
    short: 'Agents that run continuously in the background and surface work through an inbox-like review queue.',
    call: 'The vocabulary (LangChain’s "ambient agents") is ahead of the shipped reality, but the inbox-of-agent-work pattern is clearly coming. The audit trail becomes the whole UI here.',
    status: 'early', statusLabel: 'Early',
    links: [['LangChain: ambient agents', 'https://www.langchain.com/blog/introducing-ambient-agents']],
  },
]
