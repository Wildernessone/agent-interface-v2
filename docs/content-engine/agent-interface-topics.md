# Agent Interface — content engine topic surface

The daily routine draws topics from here. Edit this file to steer the engine.
The site's job: be the definitional, continuously current reference for
"agent interface" — both layers of the term:

- **Layer 1 — human ↔ agent:** the UX that keeps a person in command of an
  agent (approval gates, permission modes, streaming progress, interrupts,
  handoffs, audit trails, trust calibration).
- **Layer 2 — agent ↔ software:** the protocols and standards that wire agents
  into tools and each other (MCP, A2A, AG-UI, computer use, agentic browsers,
  llms.txt, payments protocols).

## Voice (hard rules)

- Plainspoken senior-engineer register. Zero hype: no "revolutionary,"
  "game-changer," "unlock," "seamless," "robust," "landscape" (the cliché).
- Every version number, date, and adoption claim must be verifiable from a
  source found during the run — WRITE THE SOURCE inline as a link. If it can't
  be sourced, don't claim it.
- No fabricated benchmarks, quotes, or "many teams report" filler.
- No emojis. Tables and code blocks encouraged. Title <=60 chars, dek <=155.
- Titles in sentence case ("Stopping an agent mid-task"), never Title Case — matches the site's other guides.
- Humanizer score >=85 before insert (vary rhythm; kill uniform em-dash lines).
- One honest internal link to /tracker or / where it genuinely helps; never
  force it. External links to specs/docs are encouraged (descriptive anchors).

## Evergreen topic seeds (Layer 1 — agent UX)

- The approval gate: designing human sign-off that doesn't become click-through
- Permission modes: read-only → suggest → auto — graduated autonomy done right
- Streaming progress: what an agent should show while it works (and what's noise)
- The interrupt problem: stopping an agent mid-task without corrupting state
- Handoff design: agent-to-human escalation that keeps context
- Audit trails for agent actions: what to log so trust survives an incident
- Undo for agents: reversibility as the core safety affordance
- Notification design for long-running agents (when to ping the human)
- Trust calibration: why agents should show uncertainty, and how
- The empty prompt problem: onboarding users who don't know what agents can do

## Current-events seeds (Layer 2 — protocols; research each run, source everything)

- MCP: what changed in the latest spec revision (research the changelog)
- A2A vs MCP: which layer each owns, with a real integration example
- AG-UI: standardizing the agent-frontend seam
- Agentic browsers: what the current crop actually ships (research)
- Computer use APIs: the state of screen-level agency
- llms.txt adoption: who serves one, does anything read it (research honestly —
  cite skeptics too)
- Agent payments (AP2, x402): the state of agents that spend money
- Enterprise agent governance: who approves what an agent can touch

## Series formats the engine may use

- "Explained": one protocol/pattern, definitional, canonical page per term
- "State of": dated snapshot of one corner of the space (update-friendly)
- "Teardown": how a real shipped product handles one agent-UX problem
  (only from public, verifiable material — screenshots/docs, no invention)
- "Compared": two protocols/patterns, honest table, when-to-use-which

## Internal link map

- / — the definitional hub ("what is an agent interface")
- /tracker — the living protocol/pattern index
- /guides — all articles
- /library — AI Council published verdicts (cross-link only when relevant)
