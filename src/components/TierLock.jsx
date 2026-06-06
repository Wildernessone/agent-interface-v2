/**
 * TIER LOCK — UI nudges for plan-gated capability.
 * ================================================
 * The real enforcement is in entitlements.js (the send path caps agents/tools
 * and blocks memory/storage). These are the VISIBLE side: a small lock chip on
 * gated tabs and an upgrade-nudge banner explaining what the current plan
 * allows and what Pro unlocks. The CTA routes to the Account tab (no checkout
 * yet — Stripe is deferred), so it never dead-ends.
 */

// Inline lock chip for a tab label / row — e.g. "Memory 🔒".
export function LockBadge({ requires = 'Pro' }) {
  return <span className="tier-lock-badge" title={`${requires} feature`} aria-label={`${requires} feature`}>🔒</span>
}

// Upgrade-nudge banner. Render it yourself when a surface is gated for the
// current tier; it doesn't decide gating (the caller knows the entitlement).
//   variant: 'lock'  — hard-gated (Free can't use it at all)
//            'cap'   — available but limited (e.g. 1 agent / 2 tools at a time)
export function UpgradeNudge({ title, note, requires = 'Pro', variant = 'cap', onUpgrade }) {
  return (
    <div className={`tier-nudge tier-nudge--${variant}`} role="note">
      <span className="tier-nudge-icon" aria-hidden="true">{variant === 'lock' ? '🔒' : '⬆'}</span>
      <div className="tier-nudge-body">
        <div className="tier-nudge-title">{title}</div>
        {note && <div className="tier-nudge-note">{note}</div>}
      </div>
      {onUpgrade && (
        <button type="button" className="ai-btn ai-btn--small tier-nudge-cta" onClick={onUpgrade}>
          {variant === 'lock' ? `Unlock with ${requires}` : 'See plans'}
        </button>
      )}
    </div>
  )
}
