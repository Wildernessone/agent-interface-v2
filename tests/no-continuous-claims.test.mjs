/* The site may not call itself continuously maintained (2026-10-13, James via the CoS, send-back 1540).
   The tracker was last changed 2026-09-13, while the hub, the tracker page, the guides footer, the 404 page,
   llms.txt and the MCP description all said it was "maintained continuously", "reviewed continuously", a
   "continuously updated tracker", a "living document". None of that was true, and every claim on this site
   is supposed to be. The honest wording is dated: "last updated <TRACKER_UPDATED>", "periodically re-checked".

   What it checks: every served source — public/**.html and functions/**.js — has no site claim of
   continuous upkeep: "continuous", "continuously", or "living" used of the document/tracker/index/version.
   ⚠ functions/_tracker/** is EXEMPT on purpose: those files are tracker ENTRIES, and one of them describes a
     real pattern ("Agents that run continuously in the background…"), which is not a claim about this site.
   ⚠ Comments are stripped first (HTML <!-- -->, JS block comments and whole-line // comments), so a code
     comment that says "the living index" does not fail; text a visitor or a crawler can read does.
   Run: node tests/no-continuous-claims.test.mjs */
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const walk = (d, ext, out = []) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e)
    if (statSync(p).isDirectory()) walk(p, ext, out)
    else if (e.endsWith(ext)) out.push(p)
  }
  return out
}
const CLAIM = /\bcontinuous(ly)?\b|\bliving\s+(document|version|index|tracker|reference|map)\b|\ba living\b/i
const stripHtml = s => s.replace(/<!--[\s\S]*?-->/g, '')
const stripJs = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const offenders = (files, strip) => files.flatMap(f => {
  const lines = strip(readFileSync(f, 'utf8')).split('\n')
  return lines.map((l, i) => CLAIM.test(l) ? `${f}: ${l.trim().slice(0, 140)}` : null).filter(Boolean)
})

let bad = 0
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : '\n        ' + detail}`); if (!ok) bad++ }

// The rule itself must bite, and must not bite the honest wording (a guard you have not watched fail is not a guard).
for (const s of ['Maintained continuously, every claim sourced', 'a continuously updated tracker', 'status: living document',
                 'is the living version of this map', 'A living, dated index', 'The living tracker'])
  check(`the rule catches "${s}"`, CLAIM.test(s))
for (const s of ['Every claim sourced and dated, and periodically re-checked', 'last updated 2026-09-13', 'a dated index'])
  check(`the rule passes "${s}"`, !CLAIM.test(s))

const html = walk('public', '.html')
const js = walk('functions', '.js').filter(f => !f.startsWith(join('functions', '_tracker')))
check(`denominator: ${html.length} public/**.html + ${js.length} functions/**.js (functions/_tracker/** exempt)`, html.length > 0 && js.length > 0)
const found = [...offenders(html, stripHtml), ...offenders(js, stripJs)]
check('no served page, llms.txt or MCP text claims continuous upkeep', found.length === 0, found.join('\n        '))

// The exemption is for a PATTERN the tracker documents, and it must still exist where we say it does.
const entries = walk(join('functions', '_tracker'), '.js').map(f => readFileSync(f, 'utf8')).join('\n')
check('the exempt tracker entry still describes the pattern ("Agents that run continuously in the background")',
  /Agents that run continuously in the background/.test(entries))

console.log(bad ? `\n  no-continuous-claims: ${bad} failure(s)` : '\n  no-continuous-claims: green')
process.exit(bad ? 1 : 0)
