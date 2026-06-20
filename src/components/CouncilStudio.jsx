/**
 * COUNCIL STUDIO — admin review queue for the SEO flywheel (/studio).
 * The autonomous author (scripts/council-author.mjs) and any in-app run drop
 * DRAFTS into council_pages. This is where James reviews them and publishes with
 * one click — no DB, no code. Reads/writes go through the admin RLS policy
 * (council_pages_admin_all: full access when the JWT email is the admin), so it
 * works with James's normal logged-in session and needs no service key.
 */
import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { supabase } from '../utils/supabase'
import { displayName } from '../utils/council'
import RoundtableLogo from './RoundtableLogo'
import '../styles/council.css'

const ADMIN_EMAIL = 'jamesreed@tutamail.com'
const fmtDate = (s) => { try { return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) } catch { return '' } }
const plain = (s) => String(s || '').replace(/[#*`_>]/g, '').replace(/\n{2,}/g, '\n').trim()

export default function CouncilStudio() {
  const { user } = useStore()
  const isAdmin = (user?.email || '').toLowerCase() === ADMIN_EMAIL
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(null)
  const [open, setOpen] = useState(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('council_pages')
      .select('slug,question,topic,chairman,members,verdict,status,created_at')
      .order('created_at', { ascending: false })
    if (error) setErr(error.message)
    else { setErr(null); setRows(data || []) }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; load()'s setState runs in an async continuation, not synchronously
  useEffect(() => { if (isAdmin) load() }, [isAdmin, load])

  async function mutate(fn, slug) {
    setBusy(slug); setErr(null)
    const { error } = await fn()
    setBusy(null)
    if (error) setErr(error.message)
    else load()
  }
  const publish = (slug) => mutate(() => supabase.from('council_pages').update({ status: 'published' }).eq('slug', slug), slug)
  const unpublish = (slug) => mutate(() => supabase.from('council_pages').update({ status: 'draft' }).eq('slug', slug), slug)
  const remove = (slug) => { if (window.confirm('Delete this verdict permanently?')) mutate(() => supabase.from('council_pages').delete().eq('slug', slug), slug) }

  if (!isAdmin) {
    return <div className="cp"><main className="cp-main"><p className="cp-error">Not authorized.</p></main></div>
  }

  const drafts = (rows || []).filter(r => r.status === 'draft')
  const published = (rows || []).filter(r => r.status === 'published')

  const Row = ({ r }) => (
    <div className="st-row">
      <div className="st-row-main">
        <button className="st-q" onClick={() => setOpen(open === r.slug ? null : r.slug)}>
          {r.question}
        </button>
        <div className="st-meta">
          {(r.members || []).map(displayName).join(' · ')} · chaired by {displayName(r.chairman)} · {fmtDate(r.created_at)}
          {r.topic ? ` · ${r.topic}` : ''}
        </div>
        {open === r.slug && <div className="st-preview">{plain(r.verdict)}</div>}
      </div>
      <div className="st-actions">
        {r.status === 'draft'
          ? <button className="cp-listen" disabled={busy === r.slug} onClick={() => publish(r.slug)}>{busy === r.slug ? '…' : 'Publish'}</button>
          : <>
              <a className="cp-again" href={`/council/${r.slug}`} target="_blank" rel="noreferrer">View live ↗</a>
              <button className="cp-again" disabled={busy === r.slug} onClick={() => unpublish(r.slug)}>Unpublish</button>
            </>}
        <button className="st-del" disabled={busy === r.slug} onClick={() => remove(r.slug)} title="Delete">Delete</button>
      </div>
    </div>
  )

  return (
    <div className="cp">
      <header className="cp-top">
        <Link to="/council" className="cp-back">← Council</Link>
        <div className="cp-brand"><RoundtableLogo size={24} pulse={false} /><span>Council Studio</span></div>
        <a className="cp-skip" href="/library" target="_blank" rel="noreferrer" aria-hidden="true" />
      </header>

      <main className="cp-main">
        <section className="cp-intro">
          <h1 className="cp-h1">Review the library.</h1>
          <p className="cp-sub">Drafts the council wrote, waiting on you. Publish one and it goes live at <code>/council/&lt;slug&gt;</code> instantly. <a href="/library" target="_blank" rel="noreferrer">See the public library →</a></p>
        </section>

        {err && <div className="cp-error">{err}</div>}
        {rows === null && <div className="cp-progress"><span className="cp-spinner" aria-hidden="true" />Loading…</div>}

        {rows !== null && (
          <>
            <div className="st-group">
              <div className="cp-section-label">Drafts to review · {drafts.length}</div>
              {drafts.length === 0 && <p className="cp-sub">No drafts right now. The author drops a fresh one daily.</p>}
              {drafts.map(r => <Row key={r.slug} r={r} />)}
            </div>

            <div className="st-group">
              <div className="cp-section-label">Published · {published.length}</div>
              {published.length === 0 && <p className="cp-sub">Nothing published yet.</p>}
              {published.map(r => <Row key={r.slug} r={r} />)}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
