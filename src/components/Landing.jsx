import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import RoundtableLogo from './RoundtableLogo'
import '../styles/landing.css'

// ── Data ────────────────────────────────────────────────────────────────────

const NAV_LINKS = [
  ['How it works', '#council'],
  ['The Panel', '#panel'],
  ['vs Others', '#vs'],
  ['Pricing', '#pricing'],
]

// Hero mockup — the panel actively debating. Grok disagrees with Claude.
const PANEL = [
  { id: 'claude', name: 'Claude', color: '#d97757', role: 'REALITY CHECKER', msg: 'Before we price this, what have we actually confirmed about the audience? Right now it is an assumption.' },
  { id: 'grok', name: 'Grok', color: '#b48af7', role: 'SKEPTIC', msg: 'Disagree. We are overthinking the audience and underthinking the offer. The offer is the weak link.', disagree: true },
  { id: 'gemini', name: 'Gemini', color: '#5b8def', role: 'PATTERN SPOTTER', msg: 'Both are circling the same thing — there is no clear wedge. Name the wedge and the rest follows.' },
  { id: 'deepseek', name: 'DeepSeek', color: '#4d8df0', role: 'NUMBERS', msg: 'At a 2% conversion and $25 ARPU the math only works above 4k visitors a month…', typing: true },
  { id: 'gpt', name: 'ChatGPT', color: '#10a37f', role: 'BUILDER', msg: 'Here is the concrete first move regardless of who is right…', typing: true },
]

const ROLES = [
  { n: 'SKEPTIC', c: '#d97757', h: 'Refuses to agree to be polite', d: 'Pushes back on the obvious. Stops bad plans before they get expensive.' },
  { n: 'STEEL-MANNER', c: '#10a37f', h: 'Strengthens the opposing view', d: 'Makes the counter-argument bulletproof before deciding.' },
  { n: 'BUILDER', c: '#5b8def', h: 'Proposes the concrete plan', d: 'Translates reasoning into specific actionable steps.' },
  { n: 'REALITY CHECKER', c: '#b48af7', h: 'Stress-tests assumptions', d: 'Lists every unconfirmed claim before a dollar gets spent.' },
  { n: 'PATTERN SPOTTER', c: '#4d8df0', h: 'Finds the deeper structure', d: 'Names the framework everyone is circling around.' },
  { n: 'NUMBERS PERSON', c: '#6fa1ff', h: 'Runs the actual math', d: 'Calculates costs, conversion rates, ROAS. Catches unit economics flaws.' },
  { n: 'CONTRARIAN', c: '#d97757', h: 'Opposes the consensus', d: 'Argues the opposite side on principle.' },
  { n: 'SYNTHESIZER', c: '#10a37f', h: 'Pulls competing views together', d: 'Identifies the path that honors what is true in each position.' },
  { n: 'STRATEGIST', c: '#5b8def', h: 'Thinks two moves ahead', d: 'Plans for second-order consequences.' },
]

const EXAMPLES = [
  { prompt: 'Launch my coffee roastery Q4 campaign.', files: [
    ['▤', 'Q4-launch-deck.pptx', 'saved to Drive'],
    ['◳', '3 Instagram posts', 'images + captions'],
    ['✉', 'launch-email.html', 'ready to send'],
    ['$', 'Stripe payment link', 'pre-order page'],
    ['◷', 'Calendar invite', 'launch day'],
  ]},
  { prompt: 'Research the best espresso machine under $1,500.', files: [
    ['◎', 'market-research.md', 'Perplexity · 9 sources'],
    ['▦', 'comparison.xlsx', '11 machines scored'],
    ['▤', 'recommendation.docx', 'with reasoning'],
  ]},
  { prompt: 'Make a 30-second hero ad for the new grinder.', files: [
    ['◳', '5 keyframes', 'DALL-E 3'],
    ['◍', 'voiceover.mp3', 'ElevenLabs · 28s'],
    ['♪', 'music bed', 'Stable Audio'],
    ['▶', 'hero-ad.mp4', 'finished cut'],
  ]},
  { prompt: 'Produce my podcast intro and outro.', files: [
    ['▤', 'script.md', 'intro + outro'],
    ['◍', 'cloned voice', 'ElevenLabs · 15s'],
    ['♪', 'music bed', 'Stable Audio'],
    ['▶', 'intro-outro.mp3', 'mixed'],
  ]},
  { prompt: 'Build me a React habit tracker.', files: [
    ['▤', 'architecture.md', 'components + state'],
    ['❑', 'habit-tracker.zip', 'full project'],
    ['◷', 'README.md', 'setup steps'],
  ]},
  { prompt: 'Run my weekly customer email broadcast.', files: [
    ['✉', '23 Gmail sends', 'personalized'],
    ['◳', 'Notion page', 'scheduled'],
    ['✆', 'SMS confirmation', 'Twilio'],
    ['◷', 'Calendar reminder', 'next week'],
  ]},
  { prompt: 'Turn this PDF into a pitch deck.', files: [
    ['◎', 'parsed PDF', '14 pages'],
    ['▤', 'pitch-deck.pptx', '6 slides'],
    ['▦', 'financials visual', 'chart'],
    ['◷', 'speaker-notes.docx', 'per slide'],
  ]},
]

const COMPARE = [
  ['One model, one opinion', 'Five models, debating'],
  ['You copy-paste between tabs', 'Tools fire automatically'],
  ['Forgets your context', 'Memory across projects'],
  ['Describes the work', 'Ships finished files'],
  ['Output stays in the chat', 'Saved to your Drive'],
  ['You bring nothing, it owns everything', 'Your keys, your data, your bills'],
  ['Converges on the safe answer', 'Disagreement sharpens the answer'],
]

// How the council works — the Karpathy llm-council flow, three stages.
const COUNCIL_STAGES = [
  ['01', 'Every model answers', 'Your question goes to Claude, GPT, Gemini, Grok and DeepSeek at once. Each answers independently — no groupthink, no copying the first reply.'],
  ['02', 'They rank each other blind', 'Each model judges all the answers with the names stripped off. It can’t flatter itself or play favorites — only the sharpest reasoning rises.'],
  ['03', 'The chairman delivers a verdict', 'One model synthesizes it all into a single decision — what to do, why, where the council agreed, and which dissent you should take seriously.'],
]

// The honest competitive edge — vs the other multi-AI "council" tools.
const VS_TOOLS = [
  ['Read a wall of text', 'Read it — or listen to the debate'],
  ['One vendor picks the models', 'You pick the panel, bring your own keys'],
  ['Marked-up tokens or seat fees', 'Providers bill you direct — zero markup'],
  ['Advice, then you go do the work', 'The same panel ships the deck/doc/email'],
  ['Your prompts live on their servers', 'Your keys, your data, your bills'],
]

const TOOLS = [
  { cat: 'Reasoning', items: [['Claude'], ['ChatGPT'], ['Gemini'], ['Grok'], ['DeepSeek', 'NEW'], ['Mistral', 'SOON'], ['Llama / Groq', 'SOON'], ['Qwen', 'SOON']] },
  { cat: 'Image', items: [['DALL-E 3'], ['Stable Diffusion'], ['Flux Pro'], ['Ideogram'], ['Recraft']] },
  { cat: 'Voice', items: [['ElevenLabs'], ['OpenAI TTS']] },
  { cat: 'Music', items: [['Stable Audio'], ['Suno']] },
  { cat: 'Video', items: [['Runway'], ['Luma'], ['Pika'], ['HeyGen'], ['Shotstack'], ['Meshy', 'SOON'], ['Topaz', 'SOON']] },
  { cat: 'Search', items: [['Perplexity'], ['Tavily'], ['Exa'], ['Firecrawl']] },
  { cat: 'Actions', items: [['Gmail'], ['Calendar'], ['Sheets'], ['Notion'], ['Stripe'], ['Twilio SMS']] },
  { cat: 'Storage', items: [['Drive'], ['Dropbox']] },
  { cat: 'Transcription', items: [['Whisper'], ['AssemblyAI']] },
]

const PRICING = [
  { tier: 'Pro', price: '$25', sub: '/mo', lifted: true, badge: 'Start here', rows: [
    ['✓', 'Full panel debate — all agents at once'],
    ['✓', 'Automatic orchestration — picks who speaks'],
    ['✓', 'Parallel tool execution'],
    ['✓', 'Spend mode — frugal to premium'],
    ['✓', 'All 30+ tools and actions'],
    ['✓', 'Drive, Dropbox, and memory'],
    ['✓', 'Cross-project memory bridges'],
    ['✓', 'Priority error recovery'],
    ['✓', 'Early access to new agents and tools'],
  ]},
  { tier: 'Standard', price: '$10', sub: '/mo', rows: [
    ['✗', 'No simultaneous panel debate'],
    ['✗', 'No automatic orchestration'],
    ['✗', 'No parallel tool execution'],
    ['✓', 'All agents — switch between them'],
    ['✓', 'All tools, run one at a time'],
    ['✓', 'Drive and Dropbox'],
    ['✓', 'History and memory'],
    ['✓', 'Sequential builds'],
    ['✓', 'All actions'],
  ]},
  { tier: 'Free', price: '$0', sub: '', rows: [
    ['✗', 'No panel debate'],
    ['✗', 'No multi-step builds'],
    ['✗', 'No Drive'],
    ['✗', 'No project memory'],
    ['✗', 'No history'],
    ['✗', 'No actions'],
    ['✓', 'One agent at a time'],
    ['✓', 'One tool at a time'],
  ]},
]

// ── Components ───────────────────────────────────────────────────────────────

function Eyebrow({ children }) { return <div className="lp-eyebrow">{children}</div> }

function Nav() {
  return (
    <nav className="lp-nav">
      <div className="lp-nav-inner">
        <Link to="/" className="lp-wordmark">
          <RoundtableLogo size={28} pulse={false} />
          <span>Agent Interface</span>
        </Link>
        <div className="lp-nav-links">
          {NAV_LINKS.map(([label, href]) => <a key={href} href={href}>{label}</a>)}
        </div>
        <div className="lp-nav-cta">
          <Link to="/login" className="lp-btn lp-btn-ghost">Sign in</Link>
          <Link to="/login" className="lp-btn lp-btn-fill">Start free trial</Link>
        </div>
      </div>
    </nav>
  )
}

function Hero() {
  return (
    <header className="lp-hero" id="top">
      <div className="lp-hero-copy">
        <RoundtableLogo size={88} className="lp-hero-logo" />
        <Eyebrow>// Don&apos;t trust one AI with a real decision</Eyebrow>
        <h1 className="lp-h1">Don&apos;t ask one AI.<br />Convene the council.</h1>
        <p className="lp-lead">
          Claude, GPT, Gemini, Grok and DeepSeek each answer, rank each other&apos;s
          answers blind, and a chairman hands you one clear verdict — that you can
          read, or <strong>listen to them argue out loud.</strong> The only AI
          council you can hear.
        </p>
        <div className="lp-cta-row">
          <Link to="/login" className="lp-btn lp-btn-fill lp-btn-lg">Convene your council — free</Link>
          <a href="#council" className="lp-btn lp-btn-outline lp-btn-lg">See how it works ↓</a>
        </div>
        <p className="lp-meta">Bring your own keys · Your data, your bills, zero markup</p>
      </div>
      <div className="lp-hero-mock" aria-hidden="true">
        <div className="lp-mock-head"><span className="lp-mock-dot" /><span className="lp-mock-dot" /><span className="lp-mock-dot" />
          <span className="lp-mock-title">the panel</span></div>
        {PANEL.map((a) => (
          <div className="lp-mock-msg" key={a.id}>
            <span className="lp-mock-avatar" style={{ background: a.color }}>{a.name[0]}</span>
            <div className="lp-mock-body">
              <div className="lp-mock-meta">
                <span className="lp-mock-name" style={{ color: a.color }}>{a.name}</span>
                <span className="lp-mock-role">{a.role}</span>
              </div>
              <div className="lp-mock-text">
                {a.disagree
                  ? <><span className="lp-disagree" style={{ color: a.color }}>Disagree.</span>{a.msg.replace('Disagree.', '')}</>
                  : a.typing ? <>{a.msg}<span className="lp-typing"><i /><i /><i /></span></> : a.msg}
              </div>
            </div>
          </div>
        ))}
      </div>
    </header>
  )
}

function Council() {
  return (
    <section className="lp-section" id="council">
      <Eyebrow>// How the council works</Eyebrow>
      <h2 className="lp-h2">Five minds in. One verdict out.</h2>
      <p className="lp-lead lp-lead-wide">
        A single chatbot tells you what you want to hear. A council argues, ranks,
        and convicts. It&apos;s the open llm-council method — answers, blind peer
        review, then a chairman&apos;s synthesis — wired to the best models at once.
      </p>
      <figure className="lp-council-art">
        <img src="/brand/council-hero.png" alt="Five AI models deliberate around a table and converge on a single verdict" loading="lazy" />
      </figure>
      <div className="lp-steps">
        {COUNCIL_STAGES.map(([n, t, d]) => (
          <div className="lp-step" key={n}>
            <div className="lp-step-num">{n}</div>
            <div className="lp-step-title">{t}</div>
            <div className="lp-step-desc">{d}</div>
          </div>
        ))}
      </div>
      <div className="lp-roster-bar">
        New: hear the verdict. Render any council session as a debate podcast —
        each model in its own voice — and listen to them argue it out.
      </div>
    </section>
  )
}

function VsTools() {
  return (
    <section className="lp-section" id="vs">
      <Eyebrow>// Other AIs gang up too — here&apos;s the difference</Eyebrow>
      <h2 className="lp-h2">Why this beats the other AI councils.</h2>
      <p className="lp-lead lp-lead-wide">
        Multi-AI &quot;debate&quot; tools exist. They&apos;re text boxes you read.
        We do the part none of them do — and we never touch your tokens.
      </p>
      <div className="lp-compare">
        <div className="lp-compare-head">
          <span className="lp-compare-dim">Other AI-council tools</span>
          <span className="lp-compare-bright">Agent Interface</span>
        </div>
        {VS_TOOLS.map(([a, b], k) => (
          <div className="lp-compare-row" key={k}>
            <span className="lp-compare-cell lp-compare-dim"><i className="lp-x-dot">·</i>{a}</span>
            <span className="lp-compare-cell lp-compare-bright"><i className="lp-check">✓</i>{b}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function Panel() {
  return (
    <section className="lp-section" id="panel">
      <Eyebrow>// The thing no chatbot does</Eyebrow>
      <h2 className="lp-h2">Disagreement is the feature.</h2>
      <p className="lp-lead lp-lead-wide">
        Single AIs converge on safe, average answers. Panels disagree, push back,
        and arrive somewhere sharper. Every turn, OpenClaw picks the agents AND
        the roles — pulling from a growing pool of distinct perspectives:
      </p>
      <div className="lp-roles">
        {ROLES.map((r) => (
          <div className="lp-role" key={r.n} style={{ borderTopColor: r.c }}>
            <div className="lp-role-name" style={{ color: r.c }}>{r.n}</div>
            <div className="lp-role-head">{r.h}</div>
            <div className="lp-role-desc">{r.d}</div>
          </div>
        ))}
      </div>
      <p className="lp-note">
        + more roles emerging as the panel evolves. Each turn, the orchestrator
        picks who plays what — never the same lineup twice.
      </p>
      <div className="lp-roster-bar">
        5+ agents. Claude · ChatGPT · Gemini · Grok · DeepSeek · more shipping every week.
      </div>
    </section>
  )
}

function Examples() {
  const [i, setI] = useState(0)
  const timer = useRef(null)
  useEffect(() => {
    timer.current = setInterval(() => setI((x) => (x + 1) % EXAMPLES.length), 5500)
    return () => clearInterval(timer.current)
  }, [])
  const jump = (n) => { setI(n); clearInterval(timer.current); timer.current = setInterval(() => setI((x) => (x + 1) % EXAMPLES.length), 5500) }
  const ex = EXAMPLES[i]
  return (
    <section className="lp-section" id="examples">
      <Eyebrow>// And it doesn&apos;t stop at advice</Eyebrow>
      <h2 className="lp-h2">Most councils talk.<br />This one ships the work.</h2>
      <p className="lp-lead lp-lead-wide">
        Once the verdict&apos;s in, the same panel builds it. Each of these is one
        prompt — typed once, hands-off after. The panel debates the approach, the
        tools fire, finished files land in your Drive.
      </p>
      <div className="lp-carousel">
        <div className="lp-carousel-prompt">
          <span className="lp-prompt-dollar">$</span>
          <span>{ex.prompt}</span>
        </div>
        <div className="lp-carousel-files">
          {ex.files.map(([icon, name, meta], k) => (
            <div className="lp-file" key={k}>
              <span className="lp-file-icon">{icon}</span>
              <span className="lp-file-name">{name}</span>
              <span className="lp-file-meta">{meta}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="lp-dots">
        {EXAMPLES.map((_, k) => (
          <button key={k} className={`lp-dot${k === i ? ' is-active' : ''}`} onClick={() => jump(k)} aria-label={`Example ${k + 1}`} />
        ))}
      </div>
    </section>
  )
}

function Problem() {
  const chips = [['ChatGPT.com', -4], ['Claude.ai', 3], ['DALL-E', -2], ['ElevenLabs', 5], ['Gmail Draft', -3]]
  return (
    <section className="lp-section lp-problem">
      <div className="lp-problem-top">
        <Eyebrow>// Tired of copy-pasting?</Eyebrow>
        <h2 className="lp-h2">Your AI tools don&apos;t talk to each other.</h2>
        <p className="lp-lead lp-lead-wide">
          Copy from ChatGPT. Paste into Claude. Switch tabs to DALL-E. Drag the
          image into a doc. Re-explain everything because each chatbot forgot
          your context. Email the result from a fifth tab. Forget where you saved it.
        </p>
        <p className="lp-kicker">Then do it all again tomorrow.</p>
        <div className="lp-chips">
          {chips.map(([name, rot]) => (
            <span className="lp-chip" key={name} style={{ transform: `rotate(${rot}deg)` }}>{name}</span>
          ))}
        </div>
      </div>
      <div className="lp-compare">
        <div className="lp-compare-head">
          <span className="lp-compare-dim">A single chatbot</span>
          <span className="lp-compare-bright">Agent Interface</span>
        </div>
        {COMPARE.map(([a, b], k) => (
          <div className="lp-compare-row" key={k}>
            <span className="lp-compare-cell lp-compare-dim"><i className="lp-x-dot">·</i>{a}</span>
            <span className="lp-compare-cell lp-compare-bright"><i className="lp-check">✓</i>{b}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function Tools() {
  return (
    <section className="lp-section" id="tools">
      <Eyebrow>// The roster</Eyebrow>
      <h2 className="lp-h2">Every major AI. Every major tool.</h2>
      <p className="lp-lead lp-lead-wide">
        Bring your own keys. We never see your data, never markup your tokens,
        never gate features behind our subscription.
      </p>
      <div className="lp-roster-pill">Growing roster · we add new models the week they ship</div>
      <div className="lp-tools">
        {TOOLS.map((group) => (
          <div className="lp-tool-group" key={group.cat}>
            <div className="lp-tool-cat">{group.cat}</div>
            <div className="lp-tool-tiles">
              {group.items.map(([name, tag]) => (
                <div className={`lp-tool${tag === 'SOON' ? ' is-soon' : ''}`} key={name}>
                  <span className="lp-tool-name">{name}</span>
                  {tag && <span className={`lp-tag lp-tag-${tag.toLowerCase()}`}>{tag}</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="lp-note">
        30+ tools live today. New providers ship the week they go public. No
        update fees. Every new tool drops in for everyone.
      </p>
    </section>
  )
}

function How() {
  const steps = [
    ['01', 'Drop your keys', 'Paste any AI key, connect Google Drive. Fifteen seconds.'],
    ['02', 'Ask anything', 'Type one prompt. The panel debates, then shows a plan with cost estimates before running.'],
    ['03', 'Get finished work', 'Decks, docs, sheets, images, audio, video, emails, payment links — saved to Drive.'],
  ]
  return (
    <section className="lp-section">
      <Eyebrow>// Get started in 60 seconds</Eyebrow>
      <h2 className="lp-h2">Three steps. One Drive folder full of finished work.</h2>
      <div className="lp-steps">
        {steps.map(([n, t, d]) => (
          <div className="lp-step" key={n}>
            <div className="lp-step-num">{n}</div>
            <div className="lp-step-title">{t}</div>
            <div className="lp-step-desc">{d}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function Pricing() {
  return (
    <section className="lp-section" id="pricing">
      <Eyebrow>// Pricing</Eyebrow>
      <h2 className="lp-h2">Start with everything.</h2>
      <p className="lp-lead lp-lead-wide">
        Pro is the full picture — every agent, every tool, all firing at once.
        Scale down only if you don&apos;t need them. All plans BYOK — providers
        bill you direct, we take zero markup.
      </p>
      <div className="lp-pricing">
        {PRICING.map((p) => (
          <div className={`lp-plan${p.lifted ? ' is-lifted' : ''}`} key={p.tier}>
            {p.badge && <div className="lp-plan-badge">{p.badge}</div>}
            <div className="lp-plan-tier">{p.tier}</div>
            <div className="lp-plan-price"><span>{p.price}</span><em>{p.sub}</em></div>
            <Link to="/login" className={`lp-btn lp-btn-lg ${p.lifted ? 'lp-btn-fill' : 'lp-btn-outline'}`}>
              {p.tier === 'Free' ? 'Start free' : 'Start free trial'}
            </Link>
            <ul className="lp-plan-rows">
              {p.rows.map(([mark, label], k) => (
                <li key={k} className={mark === '✓' ? 'is-yes' : 'is-no'}>
                  <span className="lp-plan-mark">{mark}</span>{label}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="lp-note">
        // All plans use YOUR API keys — providers bill you direct, we take zero markup
      </p>
    </section>
  )
}

function FinalCta() {
  return (
    <section className="lp-section lp-final">
      <Eyebrow>// Ready to ship?</Eyebrow>
      <h2 className="lp-h2 lp-h2-final">Stop juggling tools.<br />Start shipping deliverables.</h2>
      <p className="lp-lead lp-lead-wide">
        20-day free trial. No credit card required. Bring your own keys and own
        everything from day one.
      </p>
      <div className="lp-cta-row lp-cta-center">
        <Link to="/login" className="lp-btn lp-btn-fill lp-btn-lg">Start free trial</Link>
        <a href="#pricing" className="lp-btn lp-btn-outline lp-btn-lg">Compare plans</a>
      </div>
      <p className="lp-meta">// no card · cancel anytime · your keys, your bills, zero markup</p>
    </section>
  )
}

function Footer() {
  return (
    <footer className="lp-footer">
      <RoundtableLogo size={44} pulse={false} />
      <div className="lp-footer-domain">agentinterface.app</div>
      <div className="lp-footer-tag">Agent Interface · One interface. All your AI.</div>
    </footer>
  )
}

export default function Landing() {
  return (
    <div className="lp">
      <div className="lp-grid-overlay" aria-hidden="true" />
      <Nav />
      <Hero />
      <Council />
      <Panel />
      <VsTools />
      <Examples />
      <Problem />
      <Tools />
      <How />
      <Pricing />
      <FinalCta />
      <Footer />
    </div>
  )
}
