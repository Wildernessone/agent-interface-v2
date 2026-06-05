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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
