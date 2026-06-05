import { useEffect, useState, useCallback } from 'react'

/**
 * OPTIONS CARD — the brand interaction primitive.
 * ===============================================
 * Anywhere the user makes a decision, we offer 3-4 clickable options plus a
 * "something different" escape, with the same look and the same keyboard
 * shortcuts everywhere (1-4 select/confirm, Enter confirms the focused option,
 * Esc dismisses). See .agents/skills/options-first-pattern.md.
 *
 * options: [{ title, description?, meta?, detail?, badge?, accent? }]  (≤4)
 *   meta/detail/badge may be strings or React nodes. detail expands on click.
 * onSelect(option, index)        — fired on click / number key / Enter.
 * somethingDifferent: { label?, placeholder?, onSubmit(text) }  (optional escape)
 * onDismiss()                    — fired on Esc (optional).
 */
export default function OptionsCard({ options = [], onSelect, somethingDifferent, onDismiss, title }) {
  const [focus, setFocus] = useState(0)
  const [expanded, setExpanded] = useState(null)
  const [diffOpen, setDiffOpen] = useState(false)
  const [diffText, setDiffText] = useState('')

  const total = options.length + (somethingDifferent ? 1 : 0)

  const onKey = useCallback((e) => {
    if (diffOpen) return
    const n = Number(e.key)
    if (n >= 1 && n <= total) { e.preventDefault(); setFocus(n - 1); pick(n - 1); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocus(f => Math.min(f + 1, total - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setFocus(f => Math.max(f - 1, 0)) }
    if (e.key === 'Enter') { e.preventDefault(); pick(focus) }
    if (e.key === 'Escape') { e.preventDefault(); onDismiss?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, total, diffOpen])

  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  function pick(i) {
    if (somethingDifferent && i === options.length) { setDiffOpen(true); return }
    const opt = options[i]
    if (opt) onSelect?.(opt, i)
  }

  return (
    <div className="opt-card" role="listbox" aria-label={title || 'Options'}>
      {title && <div className="opt-card-title">{title}</div>}
      {options.map((o, i) => (
        <div
          key={i}
          role="option"
          aria-selected={focus === i}
          className={`opt-row${focus === i ? ' is-focus' : ''}`}
          style={o.accent ? { borderLeftColor: o.accent } : undefined}
          onMouseEnter={() => setFocus(i)}
          onClick={() => pick(i)}
        >
          <span className="opt-num">{i + 1}</span>
          <div className="opt-body">
            <div className="opt-head">
              <span className="opt-title">{o.title}</span>
              {o.badge && <span className="opt-badge">{o.badge}</span>}
            </div>
            {o.description && <div className="opt-desc">{o.description}</div>}
            {o.meta && <div className="opt-meta">{o.meta}</div>}
            {o.detail && (
              <button
                className="opt-expand"
                onClick={(e) => { e.stopPropagation(); setExpanded(expanded === i ? null : i) }}
              >{expanded === i ? 'Hide reasoning' : 'Why this option ↓'}</button>
            )}
            {o.detail && expanded === i && <div className="opt-detail">{o.detail}</div>}
          </div>
        </div>
      ))}

      {somethingDifferent && !diffOpen && (
        <div
          role="option"
          aria-selected={focus === options.length}
          className={`opt-row opt-row--diff${focus === options.length ? ' is-focus' : ''}`}
          onMouseEnter={() => setFocus(options.length)}
          onClick={() => setDiffOpen(true)}
        >
          <span className="opt-num">{options.length + 1}</span>
          <div className="opt-body"><span className="opt-title">{somethingDifferent.label || 'Something different — tell me what you want'}</span></div>
        </div>
      )}

      {somethingDifferent && diffOpen && (
        <form
          className="opt-diff"
          onSubmit={(e) => { e.preventDefault(); const t = diffText.trim(); if (t) somethingDifferent.onSubmit?.(t) }}
        >
          <input
            autoFocus
            className="opt-diff-input"
            placeholder={somethingDifferent.placeholder || 'Describe what you want instead…'}
            value={diffText}
            onChange={(e) => setDiffText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setDiffOpen(false) } }}
          />
          <button type="submit" className="opt-diff-go" disabled={!diffText.trim()}>Send</button>
        </form>
      )}

      <div className="opt-hint">1–{total} to choose · Enter to confirm{onDismiss ? ' · Esc to dismiss' : ''}</div>
    </div>
  )
}
