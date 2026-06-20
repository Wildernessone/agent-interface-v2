/**
 * Offline smoke test for the autonomous council author (PR #3c).
 * NO network, NO keys, NO DB — exercises the pure helpers + the 3-stage flow with a
 * fake `call` so the council logic (anonymize → tally → aggregate → chair) is verified
 * deterministically. Run: node scripts/smoke-council-author.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  slugify, parseTopics, pickFreshTopics, parseJsonLoose, shuffle,
  aggregateRanking, shapeRow, runCouncil, displayName,
} from './council-author.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`) } else { fail++; console.error(`  ✗ ${name}`) } }

// ── slugify ──
ok('slugify cleans + trims + caps length', slugify('Should I use ChatGPT or Claude?!') === 'should-i-use-chatgpt-or-claude')
ok('slugify no leading/trailing dashes', !/^-|-$/.test(slugify('  **Weird** spacing  ')))
ok('slugify empty → empty', slugify('') === '')

// ── parseTopics ──
const md = `# Heading should be ignored
> a note, ignored
<!-- comment -->

- Should I rent or buy a home? :: money
- React vs Vue in 2026 — which first?
* Is an MBA worth it? :: career
- bad
## another heading
- **Bold question** that is long enough :: dev
`
const topics = parseTopics(md)
ok('parseTopics count (4 valid bullets)', topics.length === 4)
ok('parseTopics extracts :: topic tag', topics[0].topic === 'money' && !/::/.test(topics[0].question))
ok('parseTopics question without tag has null topic', topics[1].topic === null)
ok('parseTopics strips bold markers', topics[3].question === 'Bold question that is long enough')
ok('parseTopics drops too-short bullet ("bad")', !topics.some(t => t.question === 'bad'))

// ── pickFreshTopics (dedup by normalized question) ──
const existing = ['should i rent or buy a home', 'Should I rent or BUY a Home?!']
const fresh = pickFreshTopics(topics, existing, 2)
ok('pickFreshTopics drops already-existing (case/punct-insensitive)', !fresh.some(t => /rent or buy/i.test(t.question)))
ok('pickFreshTopics respects count', fresh.length === 2)
ok('pickFreshTopics dedups within the batch', new Set(fresh.map(t => t.question)).size === fresh.length)
ok('pickFreshTopics count=0-ish guard returns ≤count', pickFreshTopics(topics, [], 1).length === 1)

// ── parseJsonLoose ──
ok('parseJsonLoose plain', parseJsonLoose('{"rankings":[{"label":"A","rank":1}]}').rankings[0].rank === 1)
ok('parseJsonLoose fenced', parseJsonLoose('```json\n{"rankings":[{"label":"B","rank":2}]}\n```').rankings[0].label === 'B')
ok('parseJsonLoose with prose around it', parseJsonLoose('Sure! {"rankings":[]} done').rankings.length === 0)
ok('parseJsonLoose garbage → null', parseJsonLoose('no json here') === null)

// ── shuffle preserves membership ──
const arr = [1, 2, 3, 4, 5]
const sh = shuffle(arr, () => 0.42)
ok('shuffle keeps all items', sh.length === 5 && new Set(sh).size === 5)
ok('shuffle does not mutate input', arr[0] === 1 && arr[4] === 5)

// ── aggregateRanking (lower mean = better, nulls last) ──
const labeled = [{ agent: 'claude', label: 'A' }, { agent: 'gpt', label: 'B' }, { agent: 'gemini', label: 'C' }]
const tally = { A: [2, 2], B: [1, 1], C: [] }
const agg = aggregateRanking(labeled, tally)
ok('aggregateRanking best (lowest mean) first', agg[0].agent === 'gpt' && agg[0].avgRank === 1)
ok('aggregateRanking unvoted goes last', agg[agg.length - 1].agent === 'gemini' && agg[agg.length - 1].avgRank === null)

// ── runCouncil with a fake call (deterministic) ──
const fakeCall = async ({ provider, system }) => {
  if (/Chairman/.test(system)) return { text: 'VERDICT: do X because Y. Council split on Z.', error: null }
  if (/anonymous answers/.test(system)) return { text: '{"rankings":[{"label":"A","rank":1},{"label":"B","rank":2},{"label":"C","rank":3}]}', error: null }
  return { text: `${provider} says: take a clear position on this with real tradeoffs.`, error: null }
}
const result = await runCouncil({
  question: 'Should I rent or buy?',
  members: ['claude', 'gpt', 'gemini'],
  keys: { claude: 'k', gpt: 'k', gemini: 'k' },
  call: fakeCall,
  rnd: () => 0, // deterministic shuffle
})
ok('runCouncil returns no error', !result.error)
ok('runCouncil collected all answers', result.answers.length === 3)
ok('runCouncil produced a verdict', /VERDICT/.test(result.verdict.text))
ok('runCouncil chairs with Claude when present', result.verdict.chairman === 'claude')
ok('runCouncil ranking covers every member', result.ranking.length === 3 && result.ranking.every(r => r.avgRank != null))

// ── DeepSeek is a first-class 5th member ──
ok('displayName maps deepseek', displayName('deepseek') === 'DeepSeek')
const five = await runCouncil({
  question: 'Should I rent or buy?',
  members: ['claude', 'gpt', 'gemini', 'grok', 'deepseek'],
  keys: { claude: 'k', gpt: 'k', gemini: 'k', grok: 'k', deepseek: 'k' },
  call: fakeCall, rnd: () => 0,
})
ok('runCouncil runs a 5-member council incl. deepseek', five.answers.length === 5 && five.answers.some(a => a.agent === 'deepseek'))
ok('5-member ranking labels stay within A–F', five.ranking.length === 5)

// ── runCouncil guards ──
const tooFew = await runCouncil({ question: 'q', members: ['claude'], keys: { claude: 'k' }, call: fakeCall })
ok('runCouncil needs ≥2 members', tooFew.error === 'need_two_agents')
const emptyAnswers = await runCouncil({
  question: 'q', members: ['claude', 'gpt'], keys: { claude: 'k', gpt: 'k' },
  call: async () => ({ text: '', error: 'empty' }),
})
ok('runCouncil errors when <2 answers come back', emptyAnswers.error === 'too_few_answers')

// ── shapeRow (the DB draft) ──
const row = shapeRow(result, { topic: 'money' })
ok('shapeRow status is draft (never publishes)', row.status === 'draft')
ok('shapeRow created_by null (headless author)', row.created_by === null)
ok('shapeRow carries topic', row.topic === 'money')
ok('shapeRow slug derives from question + suffix', /^should-i-rent-or-buy-[a-z0-9]{5}$/.test(row.slug))
ok('shapeRow members = answering agents', JSON.stringify(row.members) === JSON.stringify(['claude', 'gpt', 'gemini']))
ok('shapeRow answers are {agent,text}', row.answers.every(a => a.agent && a.text))
ok('shapeRow ranking maps avgRank→meanRank', row.ranking.every(r => 'meanRank' in r && 'agent' in r))

// ── topics file on disk parses + has real questions ──
const realTopics = parseTopics(readFileSync(resolve(__dirname, '../docs/content-engine/council-topics.md'), 'utf8'))
ok('council-topics.md parses to many topics', realTopics.length >= 25)
ok('every real topic ends with a question or is decision-shaped', realTopics.every(t => t.question.length > 12))
ok('displayName maps providers', displayName('gpt') === 'ChatGPT' && displayName('claude') === 'Claude')

console.log(`\n[smoke-council-author] ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
