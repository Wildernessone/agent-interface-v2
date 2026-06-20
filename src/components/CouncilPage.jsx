/**
 * COUNCIL PAGE — the dedicated /council mode.
 * Runs the llm-council 3-stage flow (src/utils/council.js) on the logged-in
 * user's own keys: every model answers → blind peer-ranking → chairman verdict.
 * Text verdict ships here; one-tap multi-voice audio lands in the follow-up PR
 * (the debate-script groundwork is exposed via councilToPodcast).
 */
import { useState, useMemo, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { supabase } from '../utils/supabase'
import { runCouncil, councilMembers, councilToSpeech, displayName, COUNCIL_AGENTS } from '../utils/council'
import { VoiceEngine } from '../utils/voiceEngine'

const ADMIN_EMAIL = 'jamesreed@tutamail.com'
const slugify = q => String(q || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '')
const shortId = () => Math.random().toString(36).slice(2, 7)
import RoundtableLogo from './RoundtableLogo'
import '../styles/council.css'

const STAGE_LABEL = {
  answers: 'Members answering independently…',
  review: 'Ranking each other blind…',
  verdict: 'Chairman synthesizing the verdict…',
}

export default function CouncilPage() {
  const { settings, user } = useStore()
  const [question, setQuestion] = useState('')
  const [running, setRunning] = useState(false)
  const [stage, setStage] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [script, setScript] = useState(null)
  const [publishing, setPublishing] = useState(false)
  const [pubSlug, setPubSlug] = useState(null)
  const [pubErr, setPubErr] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [nowIdx, setNowIdx] = useState(-1)
  const [voiceMode, setVoiceMode] = useState(null)
  const veRef = useRef(null)
  const stopRef = useRef(false)

  const members = useMemo(() => councilMembers(settings), [settings])
  const canRun = members.length >= 2 && question.trim().length > 3 && !running
  const isAdmin = (user?.email || '').toLowerCase() === ADMIN_EMAIL

  // Stop any playback when the component unmounts.
  useEffect(() => () => { stopRef.current = true; veRef.current?.stopSpeaking() }, [])

  // Speak the debate aloud, turn by turn, in each model's own voice (ElevenLabs if
  // a key is set, browser TTS otherwise). Sequential — await each turn's onDone.
  async function playDebate() {
    const s = councilToSpeech(result)
    if (!s) return
    setScript(s)
    if (!veRef.current) veRef.current = new VoiceEngine(settings)
    else veRef.current.updateSettings(settings)
    const ve = veRef.current
    stopRef.current = false
    setPlaying(true)
    setVoiceMode(ve.voiceStatus())
    for (let i = 0; i < s.turns.length; i++) {
      if (stopRef.current) break
      setNowIdx(i)
      await new Promise(res => ve.speak(s.turns[i].text, s.turns[i].agentId, res))
      setVoiceMode(ve.voiceStatus()) // may flip elevenlabs→fallback after a failed call
    }
    setPlaying(false)
    setNowIdx(-1)
  }

  function stopDebate() {
    stopRef.current = true
    veRef.current?.stopSpeaking()
    setPlaying(false)
    setNowIdx(-1)
  }

  async function publishToLibrary() {
    if (!result || publishing) return
    setPublishing(true); setPubErr(null)
    try {
      const slug = `${slugify(result.question) || 'verdict'}-${shortId()}`
      const { error: e } = await supabase.from('council_pages').insert({
        slug,
        question: result.question,
        verdict: result.verdict?.text || '',
        chairman: result.verdict?.chairman || null,
        members: result.answers.map(a => a.agent),
        answers: result.answers.map(a => ({ agent: a.agent, text: a.text })),
        ranking: (result.ranking || []).map(r => ({ agent: r.agent, meanRank: r.avgRank })),
        status: 'published',
        created_by: user?.id ?? null,
      })
      if (e) throw e
      setPubSlug(slug)
    } catch (e) {
      setPubErr(e.message || 'Could not publish.')
    } finally {
      setPublishing(false)
    }
  }

  async function convene() {
    if (!canRun) return
    stopDebate()
    setRunning(true); setError(null); setResult(null); setScript(null); setStage('answers')
    try {
      const res = await runCouncil({
        question: question.trim(),
        settings,
        onStage: (s, st) => { if (st === 'started') setStage(s) },
      })
      if (res.error) setError(errorCopy(res.error, members))
      else setResult(res)
    } catch (e) {
      setError(e.message || 'Something went wrong convening the council.')
    } finally {
      setRunning(false); setStage(null)
    }
  }

  return (
    <div className="cp">
      <header className="cp-top">
        <Link to="/app" className="cp-back">← Interface</Link>
        <div className="cp-brand"><RoundtableLogo size={24} pulse={false} /><span>The Council</span></div>
        {isAdmin ? <Link to="/studio" className="cp-back cp-studio-link">Studio →</Link> : <Link to="/app" className="cp-skip" aria-hidden="true" />}
      </header>

      <main className="cp-main">
        {!result && (
          <section className="cp-intro">
            <h1 className="cp-h1">Put it to the council.</h1>
            <p className="cp-sub">
              A decision, a belief, a plan. {members.length >= 2 ? members.map(displayName).join(', ')
                : 'Your models'} answer independently, rank each other blind, and a
              chairman hands you one verdict.
            </p>
          </section>
        )}

        <div className="cp-ask">
          <textarea
            className="cp-input"
            placeholder="e.g. Should I raise my prices 20%? Argue both sides and give me a verdict."
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={3}
            disabled={running}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) convene() }}
          />
          <div className="cp-ask-row">
            <span className="cp-members">
              {members.length >= 2
                ? `${members.length} on the panel · ${members.map(displayName).join(' · ')}`
                : 'Add at least 2 model keys in Settings to convene a council.'}
            </span>
            <button className="cp-go" onClick={convene} disabled={!canRun}>
              {running ? 'Convening…' : 'Convene the council'}
            </button>
          </div>
        </div>

        {running && stage && (
          <div className="cp-progress">
            <span className="cp-spinner" aria-hidden="true" />
            {STAGE_LABEL[stage] || 'Working…'}
          </div>
        )}

        {error && <div className="cp-error">{error}</div>}

        {result && (
          <section className="cp-result">
            <div className="cp-verdict">
              <div className="cp-verdict-tag">VERDICT · chaired by {displayName(result.verdict.chairman)}</div>
              <div className="cp-verdict-body">{renderText(result.verdict.text)}</div>
              <div className="cp-actions">
                <button className={`cp-listen${playing ? ' cp-listen--stop' : ''}`} onClick={playing ? stopDebate : playDebate}>
                  {playing ? 'Stop' : 'Hear them argue it out'}
                </button>
                {isAdmin && !pubSlug && (
                  <button className="cp-again" onClick={publishToLibrary} disabled={publishing}>
                    {publishing ? 'Publishing…' : 'Publish to library'}
                  </button>
                )}
                {pubSlug && (
                  <a className="cp-listen" href={`/council/${pubSlug}`} target="_blank" rel="noreferrer">View live page ↗</a>
                )}
                <button className="cp-again" onClick={() => { stopDebate(); setResult(null); setScript(null); setPubSlug(null); setPubErr(null) }}>New question</button>
              </div>
              {pubErr && <div className="cp-error" style={{ marginTop: 8 }}>{pubErr}</div>}
            </div>

            {result.ranking?.some(r => r.avgRank != null) && (
              <div className="cp-ranking">
                <div className="cp-section-label">How the council ranked itself (blind)</div>
                <ol className="cp-rank-list">
                  {result.ranking.map((r) => (
                    <li key={r.agent}><span className="cp-rank-name">{displayName(r.agent)}</span>
                      {r.avgRank != null && <span className="cp-rank-score">avg rank {r.avgRank.toFixed(2)}</span>}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <div className="cp-answers">
              <div className="cp-section-label">Each member, on the record</div>
              {result.answers.map((a) => (
                <details className="cp-answer" key={a.agent}>
                  <summary>{displayName(a.agent)}</summary>
                  <div className="cp-answer-body">{renderText(a.text)}</div>
                </details>
              ))}
            </div>

            {script && (
              <div className="cp-script">
                <div className="cp-section-label">Debate · {script.turns.length} turns
                  {playing && <span className="cp-soon">{voiceMode === 'elevenlabs' ? 'studio voices' : 'playing'}</span>}
                  {!playing && voiceMode && voiceMode !== 'elevenlabs' && (
                    <span className="cp-soon">browser voices — add an ElevenLabs key in Settings for studio voices</span>
                  )}
                </div>
                {script.turns.map((t, i) => (
                  <div className={`cp-line${i === nowIdx ? ' cp-line--active' : ''}`} key={i}>
                    <span className="cp-line-speaker">{t.label}{i === nowIdx ? ' ▶' : ''}</span>
                    <span className="cp-line-text">{t.text}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  )
}

function errorCopy(code, members) {
  if (code === 'need_two_agents') return `A council needs at least 2 models. You have ${members.length} key${members.length === 1 ? '' : 's'} set — add another in Settings.`
  if (code === 'too_few_answers') return 'Too few models answered (keys may be invalid or out of credit). Check your keys in Settings.'
  return 'The council could not convene. Check your model keys and try again.'
}

// Light renderer: paragraphs + simple bullet lines. Avoids a markdown dep.
function renderText(text) {
  const blocks = String(text || '').split(/\n{2,}/).filter(Boolean)
  return blocks.map((b, i) => {
    const lines = b.split('\n')
    const isList = lines.every(l => /^\s*[-*•\d.]/.test(l))
    if (isList) return <ul key={i}>{lines.map((l, j) => <li key={j}>{l.replace(/^\s*[-*•]\s?|^\s*\d+\.\s?/, '')}</li>)}</ul>
    return <p key={i}>{b}</p>
  })
}

export { COUNCIL_AGENTS }
