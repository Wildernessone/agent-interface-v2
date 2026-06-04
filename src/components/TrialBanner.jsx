import { useState } from 'react'
import { useStore } from '../store/useStore'
import { trialInfo } from '../utils/tier'

/**
 * TRIAL DOWNGRADE BANNER
 * ======================
 * Warns the user a few days before the trial steps down, naming exactly what
 * they'll lose so the loss is felt (the whole point of the 20-day taper). Shows
 * only inside the warning window (≤ WARN_DAYS before a step-down) and never for
 * paid users or once they're on Free. Dismissible per step — a NEW step-down
 * (Pro→Standard, then Standard→Free) re-shows because the key changes.
 */
const WARN_DAYS = 3

// What each step-down takes away.
const LOSE = {
  standard: 'the full panel — all four agents working together — and unlimited tools',
  free: 'memory, cloud storage, and your second tool',
}

export default function TrialBanner({ onUpgrade }) {
  const billing = useStore(s => s.billing)
  const [dismissedStep, setDismissedStep] = useState(null)

  const info = trialInfo(billing || {})
  if (!info.onTrial || info.daysUntilDowngrade == null || info.daysUntilDowngrade > WARN_DAYS) return null
  if (dismissedStep === info.nextTier) return null

  const d = info.daysUntilDowngrade
  const when = d <= 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`
  const nextLabel = info.nextTier === 'standard' ? 'Standard' : 'Free'

  return (
    <div className="trial-banner" role="status">
      <span className="trial-banner-text">
        Your trial drops to <strong>{nextLabel}</strong> {when} — you'll lose {LOSE[info.nextTier]}.
      </span>
      <div className="trial-banner-actions">
        <button className="ai-btn ai-btn--primary ai-btn--small" onClick={onUpgrade}>Keep Pro</button>
        <button className="trial-banner-dismiss" onClick={() => setDismissedStep(info.nextTier)} aria-label="Dismiss">×</button>
      </div>
    </div>
  )
}
