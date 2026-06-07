import { useState } from 'react'
import { supabase } from '../utils/supabase'
import RoundtableLogo from './RoundtableLogo'

export default function AuthScreen() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState('')

  const handleEmail = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setNotice('')
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) setError(error.message)
        // success → onAuthStateChange routes to /app
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) {
          setError(error.message)
        } else if (!data.session) {
          // Email-confirmation is on: no session is returned and the user must
          // confirm via a link. Without this branch the screen just went quiet —
          // the #1 funnel drop. Supabase returns a user with EMPTY identities
          // when the email is already registered (it won't resend), so steer
          // those to sign in instead of a confirmation that never arrives.
          if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
            setError('This email is already registered — try signing in instead.')
          } else {
            setNotice('Check your email to confirm your account, then sign in.')
          }
        }
        // else: confirmation disabled → session exists → routed to /app
      }
    } catch (err) {
      setError(err?.message || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleOAuth = async (provider) => {
    setOauthLoading(provider)
    setError('')
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.origin },
      })
      // On success the browser redirects away; keep the button in its loading
      // state. On failure (popup blocked, misconfig, network) reset it and show
      // the error instead of leaving the button stuck on "Redirecting…".
      if (error) {
        setError(error.message)
        setOauthLoading('')
      }
    } catch (err) {
      setError(err?.message || `Couldn't start ${provider} sign-in.`)
      setOauthLoading('')
    }
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-brand">
          <RoundtableLogo size={56} />
          <h1>Agent Interface</h1>
          <p>One interface. All your AI.</p>
          <p className="auth-trial">Start 20-day free trial. No credit card required.</p>
        </div>

        <button
          className="auth-oauth auth-oauth--apple"
          onClick={() => handleOAuth("apple")}
          disabled={!!oauthLoading}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <path d="M11.4 8.3c0-1.5 1.2-2.2 1.3-2.3-.7-1-1.8-1.2-2.2-1.2-.9-.1-1.8.6-2.3.6-.5 0-1.2-.6-2-.5-1 0-2 .6-2.5 1.5-1.1 1.9-.3 4.7.8 6.2.5.8 1.1 1.6 1.9 1.6.8 0 1.1-.5 2.1-.5s1.2.5 2 .5c.8 0 1.4-.7 1.9-1.5.6-.9.8-1.7.9-1.8-.1 0-1.9-.7-1.9-2.6zm-1.6-4.7c.4-.5.7-1.2.6-1.9-.6 0-1.3.4-1.7.9-.4.4-.7 1.1-.6 1.8.7.1 1.4-.3 1.7-.8z"/>
          </svg>
          {oauthLoading === "apple" ? "Redirecting…" : "Continue with Apple"}
        </button>

        <button
          className="auth-oauth"
          onClick={() => handleOAuth("google")}
          disabled={!!oauthLoading}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            <path d="M15.7 8.2c0-.6-.1-1.1-.2-1.6H8v3h4.3c-.2 1-.7 1.8-1.6 2.4v2h2.6c1.5-1.4 2.4-3.5 2.4-5.8z" fill="#4285F4"/>
            <path d="M8 16c2.2 0 4-.7 5.3-2l-2.6-2c-.7.5-1.6.8-2.7.8-2.1 0-3.8-1.4-4.5-3.3H.8v2.1C2.1 14.2 4.8 16 8 16z" fill="#34A853"/>
            <path d="M3.5 9.5c-.2-.5-.3-1-.3-1.5s.1-1 .3-1.5V4.4H.8C.3 5.5 0 6.7 0 8s.3 2.5.8 3.6l2.7-2.1z" fill="#FBBC05"/>
            <path d="M8 3.2c1.2 0 2.3.4 3.1 1.2l2.3-2.3C12 .9 10.2 0 8 0 4.8 0 2.1 1.8.8 4.4l2.7 2.1C4.2 4.6 5.9 3.2 8 3.2z" fill="#EA4335"/>
          </svg>
          {oauthLoading === "google" ? "Redirecting…" : "Continue with Google"}
        </button>

        <div className="auth-divider"><span>or</span></div>

        <div className="auth-mode">
          {[
            { id: "login",  label: "Sign in" },
            { id: "signup", label: "Sign up" },
          ].map(m => (
            <button
              key={m.id}
              className={`auth-mode-btn${mode === m.id ? " is-active" : ""}`}
              onClick={() => { setMode(m.id); setError(''); setNotice('') }}
            >{m.label}</button>
          ))}
        </div>

        <form onSubmit={handleEmail} className="auth-form">
          <input
            className="auth-input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <input
            className="auth-input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
          {error && <div className="auth-error" role="alert">{error}</div>}
          {notice && <div className="auth-notice" role="status" style={{ color: '#34A853', fontSize: 13, textAlign: 'center' }}>{notice}</div>}
          <button type="submit" className="ai-btn ai-btn--primary auth-submit" disabled={loading}>
            {loading ? "…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="auth-fineprint">
          By continuing you agree to the{' '}
          <a href="/terms.html" target="_blank" rel="noopener noreferrer">Terms</a> and{' '}
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
          Your AI keys stay in your account.
        </p>
      </div>
    </div>
  )
}

