// Machine-readable twin of /tracker — tools and agents can consume the index
// directly (the endoflife.date lesson: consumers who script against you stay).
import { TRACKER, TRACKER_UPDATED } from './_tracker-data.js'

export function onRequestGet() {
  const body = JSON.stringify({
    site: 'https://agentinterface.app',
    updated: TRACKER_UPDATED,
    license: 'Facts are facts; the editorial calls are CC BY 4.0 with attribution to agentinterface.app.',
    entries: TRACKER,
  }, null, 2)
  return new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=600, s-maxage=3600', 'access-control-allow-origin': '*' } })
}
