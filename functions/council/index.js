// Bare /council — the old SPA app route. The app is retired; published council
// verdicts live on as the Library archive. Permanent redirect preserves any
// old links' equity.
export function onRequestGet() {
  return new Response(null, { status: 301, headers: { Location: '/library' } })
}
