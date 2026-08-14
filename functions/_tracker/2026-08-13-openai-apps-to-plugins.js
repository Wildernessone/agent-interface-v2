// Refines 'openai-apps' — the App Directory it described no longer exists as a
// standalone thing. See CLAUDE.md for how changesets fold.

export const checked = '2026-08-13'

export const entries = [
  {
    id: 'openai-apps', group: 'protocol', name: 'OpenAI Apps SDK',
    steward: 'OpenAI (built on MCP; packaged via the Agent Plugins spec since Jul 2026)',
    short: 'Apps that render and act inside ChatGPT and Codex. The standalone App Directory (Dec 2025) was folded into a shared Plugin Directory on Jul 9, 2026, bundling apps with skills under the cross-vendor Agent Plugins format.',
    call: 'The "not an open standard" read has aged out. A month before Agent Plugins hit 1.0.0, OpenAI had already rebuilt its own directory around that exact packaging shape — and OpenAI sits on the spec\'s steering committee with ChatGPT and Codex as launch clients. The Apps SDK still builds the MCP-server-plus-UI half of a plugin, but distribution now runs through a format five other vendors signed off on, not a closed OpenAI store. What stayed OpenAI\'s: review, featuring, and the directory surface itself — the spec governs packaging, not curation. See /tracker#agent-plugins for the standard.',
    status: 'rising', statusLabel: 'Rising',
    links: [['Apps SDK', 'https://developers.openai.com/apps-sdk'], ['Open submissions (Dec 2025)', 'https://openai.com/index/developers-can-now-submit-apps-to-chatgpt/'], ['Plugin Directory migration (Jul 9, 2026)', 'https://help.openai.com/en/articles/20001256-plugins-in-chatgpt-and-codex'], ['Plugin architecture', 'https://developers.openai.com/plugins']],
  },
]
