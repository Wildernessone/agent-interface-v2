/**
 * SUGGESTED PROMPTS — renders the state-aware suggestions from suggestPrompts().
 * Starters/setup cards just populate the composer; continue/example/next cards
 * auto-send. Setup cards route to the relevant settings surface instead.
 */
export default function SuggestedPrompts({ suggestions = [], onPick, title }) {
  if (!suggestions.length) return null
  return (
    <div className="sp-list" role="list" aria-label={title || 'Suggested prompts'}>
      {title && <div className="sp-title">{title}</div>}
      {suggestions.map((s, i) => (
        <button
          key={`${s.type}-${i}-${s.label}`}
          role="listitem"
          className={`sp-card sp-card--${s.type}`}
          onClick={() => onPick?.(s)}
        >
          <span className="sp-icon" aria-hidden="true">{s.icon}</span>
          <span className="sp-body">
            <span className="sp-label">{s.label}</span>
            {s.meta && <span className="sp-meta">{s.meta}</span>}
          </span>
        </button>
      ))}
    </div>
  )
}
