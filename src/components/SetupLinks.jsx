// Renders a provider's setup deep-links as a row of chips plus a short
// "what you'll see" line and an optional gotcha note. Driven entirely by a
// `setup` object so it works for agents (Settings, Onboarding) and tools
// (registry.js) alike — and the same objects feed the Phase 2 help assistant.
//
// setup shape (every field optional except you'll usually want getKeyUrl):
//   { signupUrl, getKeyUrl, billingUrl, docsUrl, seeText, note }
export default function SetupLinks({ setup }) {
  if (!setup) return null
  const { signupUrl, getKeyUrl, billingUrl, docsUrl, seeText, note } = setup
  const hasChip = signupUrl || getKeyUrl || billingUrl || docsUrl
  return (
    <div className="setup-links">
      {hasChip && (
        <div className="setup-chips">
          {signupUrl  && <a className="setup-chip" href={signupUrl}  target="_blank" rel="noreferrer">Sign up ↗</a>}
          {getKeyUrl  && <a className="setup-chip setup-chip--primary" href={getKeyUrl} target="_blank" rel="noreferrer">Get key ↗</a>}
          {billingUrl && <a className="setup-chip" href={billingUrl} target="_blank" rel="noreferrer">Billing ↗</a>}
          {docsUrl    && <a className="setup-chip" href={docsUrl}    target="_blank" rel="noreferrer">Docs ↗</a>}
        </div>
      )}
      {seeText && <div className="setup-see">{seeText}</div>}
      {note    && <div className="setup-note">{note}</div>}
    </div>
  )
}
