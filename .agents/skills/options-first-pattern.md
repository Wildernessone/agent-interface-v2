# Options-first interaction pattern

The brand interaction language for Agent Interface. **Anywhere the user makes a
decision, offer 3-4 clickable options plus a "something different" escape** —
with the same look and the same keyboard shortcuts everywhere. The panel is the
product; choosing a direction should feel like the panel handing you a menu, not
a dead-end button.

## The primitive

`src/components/OptionsCard.jsx` — use it everywhere. Never hand-roll another
chooser.

```jsx
<OptionsCard
  title="Build options"
  options={[
    { title, description?, meta?, detail?, badge?, accent? },  // ≤ 4
  ]}
  onSelect={(option, index) => { /* act */ }}
  somethingDifferent={{ label?, placeholder?, onSubmit(text) }}  // optional escape
  onDismiss={() => { /* optional Esc handler */ }}
  keyboard={true}   // false for SECONDARY inline choosers so multiple don't
                    // fight over the number keys (only one primary chooser
                    // should own the keyboard at a time)
/>
```

- `meta` / `detail` / `badge` accept strings or React nodes. `detail` expands on click.
- Keyboard (when `keyboard`): **1-4 select/confirm**, **↑/↓ move focus**, **Enter
  confirms the focused option**, **Esc dismisses**.

## Where it's applied

1. **Panel-first build options** (`BuildOptionsTurn`) — primary, owns the keyboard.
   The debate → 3-4 directions with cost/time/champions/consensus.
2. **Build retry** — Retry exactly / Try smaller scope / Abort (on the build card).
3. **Empty-state prompts** — the 4 landing examples as a chooser.
4. **Failed-step recovery** — Skip and continue / Retry this step / Substitute provider / Abort.
5. **Project-creation intake** — Paste a brief / Walk through questions / Pull from URL.
6. **Voice toggle** — Voice now / Voice from next message / Off.

## Rules

- 3-4 real options, never 2 (use a plain confirm for binary).
- The 4th slot is almost always a "something different" / free-text escape.
- Consistent visual: number chip, title, one-line description, optional meta.
- Secondary inline choosers pass `keyboard={false}`.
