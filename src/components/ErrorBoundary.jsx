import { Component } from 'react'
import { logError } from '../utils/telemetry'

// App-wide error boundary. Without this, ANY thrown render (a malformed
// persisted turn, an unexpected tool-output shape, a bug in a deep component)
// unmounts the whole React tree to a blank white page with no recovery — the
// product looks dead. This catches the throw, reports it to Sentry via
// logError, and shows a recoverable fallback instead.
//
// Two ways to use it:
//   <ErrorBoundary scope="app">…            → default full-screen fallback (Reload)
//   <ErrorBoundary scope="turn" fallback={(err, reset) => <CompactCard/>}>…
// A function `fallback` receives (error, reset) so a per-turn boundary can
// degrade one item to a small card instead of taking down its siblings.
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    logError(this.props.scope || 'react', error, { componentStack: info?.componentStack })
  }

  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    if (typeof this.props.fallback === 'function') return this.props.fallback(error, this.reset)
    if (this.props.fallback) return this.props.fallback

    // Default: full-screen recoverable fallback. Inline-styled so it renders
    // even if a CSS/chunk failure is what broke the app.
    return (
      <div role="alert" style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24,
        background: '#0f0f10', color: '#e7e7e7', textAlign: 'center',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Something went wrong</div>
        <div style={{ fontSize: 14, opacity: 0.7, maxWidth: 420 }}>
          The app hit an unexpected error. Your data is safe — reloading usually fixes it.
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <button onClick={() => window.location.reload()} style={btnStyle(true)}>Reload</button>
          <button onClick={() => { window.location.href = '/app' }} style={btnStyle(false)}>Start fresh</button>
        </div>
      </div>
    )
  }
}

function btnStyle(primary) {
  return {
    padding: '10px 20px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
    border: primary ? 'none' : '1px solid #3a3a3a',
    background: primary ? '#6366f1' : 'transparent',
    color: primary ? '#fff' : '#e7e7e7',
  }
}
