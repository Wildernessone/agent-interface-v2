// Lightweight loading placeholder for list-style fetches (History, Prompts,
// Memory). Decorative — hidden from assistive tech; the surrounding container
// should expose aria-busy while loading.
export function SkeletonList({ rows = 5 }) {
  return (
    <div className="skeleton-list" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton-row" />
      ))}
    </div>
  )
}
