import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './utils/supabase'
import { useStore } from './store/useStore'
import { initTelemetry, identifyUser } from './utils/telemetry'
import { captureDriveTokens } from './utils/driveStorage'
import { finishDropboxAuth } from './utils/dropboxStorage'
import { finishRedditAuth } from './utils/redditAuth'
import { applyTheme } from './utils/applyTheme'
import { trackSessionStart, trackLogin, setTrackUser } from './utils/track'
import AuthScreen from './components/AuthScreen'
import TheInterface from './components/TheInterface'
import CouncilPage from './components/CouncilPage'
import Landing from './components/Landing'
import './App.css'

initTelemetry()

export default function App() {
  const { user, setUser, setSession, loadSettings, settings, loadSkills } = useStore()
  // Don't route until the first session check resolves, so a logged-in visitor
  // hitting "/" goes straight to /app instead of flashing the landing.
  const [authReady, setAuthReady] = useState(false)

  // Live-apply theme + accent + font + bubble whenever settings change
  useEffect(() => { applyTheme(settings) }, [settings?.themeId, settings?.accent, settings?.fontSize, settings?.bubbleStyle])

  // Handle Dropbox + Reddit OAuth callbacks on first load
  useEffect(() => { finishDropboxAuth() }, [])
  useEffect(() => { finishRedditAuth() }, [])

  // Returning from Stripe Checkout — the webhook updates the tier asynchronously,
  // so re-pull settings a few times to reflect the new plan, then clean the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const checkout = params.get('checkout')
    if (!checkout) return
    let cancelled = false
    if (checkout === 'success') {
      // The Stripe webhook updates the tier asynchronously. Poll with backoff
      // until the subscription reads 'active' (up to ~30s) instead of giving up
      // at 6s and leaving a just-paid user on their old tier until a manual
      // reload — the worst billing UX.
      ;(async () => {
        for (const ms of [1000, 2000, 3000, 5000, 8000, 12000]) {
          if (cancelled) return
          await new Promise(r => setTimeout(r, ms))
          if (cancelled) return
          await loadSettings()
          if (useStore.getState().billing?.subscription_status === 'active') return
        }
      })()
    }
    params.delete('checkout')
    const qs = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    trackSessionStart()
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      identifyUser(session?.user)
      setTrackUser(session?.user?.id)
      if (session) {
        loadSettings()
        if (session.provider_token) captureDriveTokens()
        // Pull skills from Drive into the store. Runs in the background;
        // agents pick them up on the next system-prompt build.
        loadSkills()
      }
      setAuthReady(true)
    }).catch(() => setAuthReady(true))

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session)
        setUser(session?.user ?? null)
        identifyUser(session?.user)
        setTrackUser(session?.user?.id)
        if (event === 'SIGNED_IN') trackLogin()
        if (session) {
          loadSettings()
          if (session.provider_token) captureDriveTokens()
          loadSkills()
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  // Blank during the first auth check (avoids a landing/app flash).
  if (!authReady) return <div className="app-boot" />

  return (
    <Routes>
      <Route path="/" element={user ? <Navigate to="/app" replace /> : <Landing />} />
      <Route path="/login" element={user ? <Navigate to="/app" replace /> : <AuthScreen />} />
      <Route path="/app" element={user ? <TheInterface /> : <Navigate to="/login" replace />} />
      <Route path="/council" element={user ? <CouncilPage /> : <Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
