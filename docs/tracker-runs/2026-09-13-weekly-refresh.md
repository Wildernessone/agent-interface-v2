# Tracker weekly refresh, 2026-09-13

Run by hand in-session against primary sources (WebFetch, curl with a browser UA, `gh api`);
WebSearch was unavailable for the whole session, which is the method CLAUDE.md prefers anyway.

## Scope, stated plainly

The live tracker at agentinterface.app/tracker.json had **29 entries** on 2026-09-13, all stamped
2026-08-26/27 by two published `tracker_changesets` rows (`full-sweep-2026-08-26`, 28 entries;
`webmcp`, 1 entry). The brief for this run said 28 entries last refreshed 2026-08-22; that was the
repo baseline, not the live site. Everything below was verified against the **live** text.

- **16 of 29 checked.** 14 fully, and those 14 are restated in the changeset so each carries the
  date it was actually checked. 2 checked only partially (`a2a`, `atlas`) and therefore **not**
  restated; they keep their 2026-08-26 dates.
- **13 not checked this week** and untouched: llms-txt, mcp-apps, approval-gate, permission-modes,
  interrupt-resume, streaming-progress, audit-trail, os-agent-workspaces, handoff, coding-agents,
  agentic-browsers, in-chat-apps, ambient-agents.

## What this run wrote, and what it deliberately did not

- `docs/tracker-runs/2026-09-13-changeset.json`: the 14 whole entries.
- `docs/tracker-runs/2026-09-13-changeset.sql`: the one-row `insert into tracker_changesets`
  that CLAUDE.md names as the update path. **It was not executed.** The row auto-publishes 48h
  after insert, and this run was not permitted to write to production; running it is a human
  decision.
- **No file under `functions/_tracker/`, on purpose.** `loadTracker()` folds
  `CHANGESETS.concat(db)`, so every published DB row folds after every repo file. The 2026-08-27
  sweep row replaces all 28 baseline ids, so a new file changeset would be silently overridden
  for every one of them and would only bump `TRACKER_UPDATED`, which is the cosmetic-freshness
  move CLAUDE.md forbids. CLAUDE.md now says this in one paragraph.

## Moved (7 entries, each claim with its source, quote and the date it was read)

### webmcp (status stays `early` / "Origin trial"; the engine positions are the finding)

- WebKit standards-positions #670, closed, label `position: oppose`. Comment 2026-06-03:
  "WebKit is **opposed** to this proposal due to the following concerns: - Although
  browser-integrated agents could struggle to act on interfaces built for humans, we do not
  think a parallel agent-facing tool layer is the right solution." Comment 2026-06-17: "Our
  view is that WebMCP proposes a new solution before the actual problem has been established."
  https://github.com/WebKit/standards-positions/issues/670 (read 2026-09-13 via `gh api`)
- Mozilla standards-positions #1412: labeled `position: neutral` 2026-08-05T09:46:21Z and closed
  2026-08-05T09:46:27Z. Jake Archibald (MEMBER), 2026-08-25: "I haven't really looked at the
  declarative API. It sounds like a reasonable idea, but I don't think it should be instead of
  an imperative way to call functions between environments."
  martinthomson (MEMBER), 2026-08-26: "It's an interesting thing to contemplate, but, as Jake says, it's not a significant factor." — the sentence the entry's "not a significant factor" rests on.
  https://github.com/mozilla/standards-positions/issues/1412 (read 2026-09-13)
- Draft CG Report date: `<time class="dt-updated" datetime="2026-09-10">10 September 2026</time>`
  (live entry said 26 August 2026). https://webmachinelearning.github.io/webmcp/ (read 2026-09-13)
- implementation-status.md: "# ChatGPT Desktop / WebMCP is supported in ChatGPT Desktop."
  (commit 2ac94f5, 2026-08-26, "Add ChatGPT Desktop to implementation status (#258)");
  "# Brave / Experimental support is added to Leo AI chat."; "# Chrome / An Origin Trial is live
  in Chrome 149."; "# Edge / An Origin Trial is live in Edge 150."
  https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md (read 2026-09-13)
- README, PR #296 merged 2026-09-04T20:29:18Z ("Update README with refined definition of
  headless usecases"): "**Headless browsing scenarios**: Tools exposed for human-in-the-loop can
  also be used for task completion in headless scenarios". (read 2026-09-13)
- Unchanged and re-confirmed: Chrome Platform Status 5117755740913664 origin trial
  `desktop_first: 149 ... desktop_last: 156`, `tag_review_status: "Pending"`,
  `security_review_status: "Pending"`, `privacy_review_status: "Pending"`, maturity
  "Specification being incubated in a Community Group", entry updated 2026-08-12
  (https://chromestatus.com/api/v0/features/5117755740913664, read 2026-09-13). Edge trial page:
  "Trial Expiration Date November 17, 2026" (read 2026-09-13). Chrome docs: "Both APIs are gated
  by the `tools` Permissions Policy. The policy defaults to `self`", "Last updated 2026-08-07 UTC".

### x402

- Members page headings "Premier Members" / "General Members" / "Associate Members"; 52
  `members-item` cards (17 + 24 + 11) including Visa Inc., MasterCard Incorporated, Amazon Web
  Services, Inc., American Express, Ripple Labs Inc., Solana Foundation. Live entry said 49.
  https://x402.org/members/ (read 2026-09-13)
- Homepage: "Last 30 Days 75.41M Transactions $24.24M Volume 94.06K Buyers 22K Sellers", the same
  figures to the rounding the entry recorded on 2026-08-26. https://x402.org/ (read 2026-09-13)
- Canonical repo is now `x402-foundation/x402` (6,608 stars, pushed 2026-09-11); `coinbase/x402`
  reports `fork: true, parent: x402-foundation/x402`. (`gh api`, 2026-09-13)

### agents-md

- "A simple, open format for guiding coding agents, used by over 60k open-source projects."
  and "AGENTS.md is now stewarded by the Agentic AI Foundation under the Linux Foundation."
  https://agents.md/ (read 2026-09-13). Repo `agentsmd/agents.md` pushed 2026-09-10T18:46:16Z.

### openai-apps

- `https://developers.openai.com/apps-sdk` answers `HTTP 301 -> https://developers.openai.com/plugins`
  (curl, 2026-09-13), confirming the redirect.
- But the docs index still names it: "[ChatGPT plugins and Apps SDK](https://developers.openai.com/plugins/llms.txt)"
  and "[Plugins and Apps SDK quickstart](https://developers.openai.com/plugins/build/app-quickstart.md)"
  https://developers.openai.com/llms.txt (read 2026-09-13). The `short` now says the URL is
  retired and the name is not quite.

### zed-acp

- "ACP is jointly governed by Zed and JetBrains" ... "The following is an interim governance
  model" ... "ACP has two lead maintainers: Ben Brandt (Zed Industries) and Sergey Ignatov
  (JetBrains)." ... "toward transitioning to an independent foundation."
  https://agentclientprotocol.com/community/governance (read 2026-09-13); `docs/community/governance.mdx`
  commit 3724725, 2026-02-19, "docs(governance): Announce Sergey as Lead Maintainer (#543)".
- Releases: newest are `v1.7.0`, `schema-v1.21.0`, `schema-v2.0.0-alpha.3`, all 2026-08-20;
  nothing since (`gh api`, 2026-09-13). Registry: 42 agent directories at
  https://github.com/agentclientprotocol/registry (pushed 2026-09-13).

### mcp

- "The **current** protocol version is **2026-07-28**." https://modelcontextprotocol.io/specification/versioning
  (read 2026-09-13). Newest tag on the spec repo is still `2026-07-28` (published 2026-07-28T16:47:49Z).
- Deprecated registry: Roots, Sampling, Logging, all "SEP-2577", "Deprecated in `2026-07-28`",
  "Earliest removal: First revision released on or after 2027-07-28".
  https://modelcontextprotocol.io/specification/2026-07-28/deprecated (read 2026-09-13)
- Roadmap post "The New MCP Roadmap", August 22, 2026: "The bulk of the changes landed in the
  2026-07-28 specification release." https://blog.modelcontextprotocol.io/posts/mcp-roadmap/
- The registry count was NOT re-counted (the API paginates with no total; the homepage renders
  client-side), so the entry now dates the figure: "passed 25,000 servers in August 2026".

### ag-ui

- docs.ag-ui.com/concepts/events (re-read 2026-09-14): 31 current event types; five marked deprecated
  (THINKING_START, THINKING_END, THINKING_TEXT_MESSAGE_START, THINKING_TEXT_MESSAGE_CONTENT,
  THINKING_TEXT_MESSAGE_END — "The following events are deprecated and will be removed in version
  1.0.0. Use the corresponding Reasoning events instead."); one draft type (MetaEvent) plus two draft
  lifecycle variants that extend RunStarted/RunFinished rather than add types. An earlier draft of this
  report said "34 documented, two deprecated" — wrong; corrected after an independent re-read.
  (read 2026-09-13)
- README names no foundation, governance or stewardship body (read 2026-09-13). Newest release
  `release/2026-09-11` (`gh api`, 2026-09-13). Steward line unchanged: still the holdout.

## Verified unchanged and restated (7 entries)

- **agent-plugins**: `MAINTAINERS.md` lists five (Liguori/Amazon, Sadanani/Cursor,
  Kirschner/Microsoft, Verma/OpenAI, Hefner/Vercel); PR #37 "Update MAINTAINERS.md" `state: open`,
  last updated 2026-08-06; newest commit ff8ab5e 2026-08-19 "Merge pull request #65 ...
  start-v1.1.0"; spec/1.1.0.md "Status: Working Draft", no date. (`gh api` + raw, 2026-09-13)
- **agent-builder**: "On June 3, 2026, we notified developers using Agent Builder that the
  product is being deprecated. ChatKit remains available." Agent Builder shutdown 2026-11-30;
  Evals "existing evaluations become read-only" 2026-10-31, "The Evals dashboard and API are
  scheduled to shut down" 2026-11-30; migration "Agents SDK or ChatGPT Workspace Agents";
  "Moving from OpenAI Evals to Promptfoo". https://developers.openai.com/api/docs/deprecations
  (read 2026-09-13). Dates made exact in the entry.
- **computer-use**: "Computer use is available on the Claude API and Google Cloud as the
  `computer_toolset_20260801` toolset" (platform.claude.com computer-use-tool, 2026-09-13);
  "In supported regions, Computer Use in the ChatGPT desktop app is available on macOS and
  Windows with ChatGPT Work and Codex." and "When you enable locked use, ChatGPT installs an
  Apple authorization plug-in that participates in the macOS unlock flow." (learn.chatgpt.com
  computer-use.md, 2026-09-13); "Gemini 3.x models support three environments ... Browser ...
  Mobile ... Desktop", "Last updated 2026-09-04 UTC" (ai.google.dev computer-use, 2026-09-13).
- **agent-protocol**: repo `agi-inc/agent-protocol` (the `AI-Engineer-Foundation` name redirects
  there) `pushed_at 2025-04-08T06:10:21Z`, not archived; agentprotocol.ai `<title>AgentProtocol.ai
  — AI agent protocols explained</title>`, description "an independent, vendor-neutral guide".
  (2026-09-13)
- **ibm-acp**: "This repository was archived by the owner on Aug 27, 2025. It is now read-only."
  https://github.com/i-am-bee/acp (read 2026-09-13)
- **operator**: `https://operator.chatgpt.com` answers `HTTP 308 -> https://chatgpt.com/?system_hints=agent`
  (curl, 2026-09-13).
- **ap2**: release `v0.2.0` published 2026-04-28 (`gh api`); FIDO post dated April 28, 2026 names
  the "Payments Technical Working Group" chaired by Mastercard and Visa and Mastercard's
  "Verifiable Intent framework, co-developed with Google and designed to work with AP2".
  https://fidoalliance.org/fido-alliance-to-develop-standards-for-trusted-ai-agent-interactions/ (read 2026-09-13)

## Checked, partially; not restated

- **a2a**: newest release still `v1.0.1` (2026-05-28); milestone `v1.1` open, due 2026-10-22,
  3 open / 0 closed issues; https://aaif.io/blog/a2a-joins-aaif is titled "A2A joins AAIF's open
  agentic stack", dated 2026-08-17. The entry's TAC-in-July / board-on-Aug-4 / Growth-vs-Impact
  stage details are not in that page's HTML (aaif.io renders client-side) and were not
  re-located, so the entry keeps its 2026-08-26 date rather than a check it did not get.
- **atlas**: 9to5mac (Jul 9 2026, https://9to5mac.com/2026/07/09/openai-is-discontinuing-chatgpt-atlas-its-standalone-desktop-browser/) quotes OpenAI: "The current targeted date for deprecation is
  8/9". Whether it actually went dark on 2026-08-09 could not be re-verified: openai.com,
  chatgpt.com/atlas and help.openai.com all answer 403 to automated fetch.

## Not tracker entries, checked because the brief named them

- Anthropic Agent Skills (`anthropics/skills`, pushed 2026-09-10), OpenAI Agents SDK
  (`openai/openai-agents-python` v0.22.2, 2026-09-09), Google ADK (`google/adk-python` v2.9.0,
  2026-09-10) are frameworks, not tracked interfaces; nothing here argues for a new row.

## Links

Every external link on the 15 entries above was fetched on 2026-09-13: 52 answered 200. The rest
are blocked to automated fetch, not dead: openai.com (3) and help.openai.com (1) answer 403,
github.com/.../MAINTAINERS.md answered 429 on the sweep but was read via raw.githubusercontent.com,
and ai.google.dev/gemini-api/docs/computer-use redirects cross-host (read via WebFetch).

## Checks run

- `node --check functions/_tracker-data.js` and the CLAUDE.md import check: 28 entries in the
  repo baseline, updated 2026-08-22, no duplicate id, every entry has a link (unchanged files).
- The changeset builder asserts every string-replace target exists exactly once; every entry has
  id/group/name/steward/short/call/status/statusLabel/links, a valid status, at least one link,
  no `checked` field and no emoji.
- The SQL payload was re-extracted from between its `$j$` markers and parsed back to the exact
  JSON file; a simulated fold of the live 29 entries plus this row gives 29 entries in the same
  order, 14 stamped 2026-09-13, newest `checked` 2026-09-13.

## To publish

Run `docs/tracker-runs/2026-09-13-changeset.sql` against the v2 Supabase project. The row lands
as `draft` and the hourly `ai-tracker-auto-publish` cron (verified `active: true` on 2026-09-13)
publishes it 48h later; set it `archived` before then to veto.
