import { useEffect } from 'react'
import { supabase } from './utils/supabase'
import { useStore } from './store/useStore'
import { initTelemetry, identifyUser } from './utils/telemetry'
import { captureDriveTokens } from './utils/driveStorage'
import { finishDropboxAuth } from './utils/dropboxStorage'
import { finishRedditAuth } from './utils/redditAuth'
import { applyTheme } from './utils/applyTheme'
import AuthScreen from './components/AuthScreen'
import TheInterface from './components/TheInterface'
import './App.css'

initTelemetry()

export default function App() {
  const { user, setUser, setSession, loadSettings, settings, loadSkills } = useStore()

  // Live-apply theme + accent + font + bubble whenever settings change
  useEffect(() => { applyTheme(settings) }, [settings?.themeId, settings?.accent, settings?.fontSize, settings?.bubbleStyle])

  // Handle Dropbox + Reddit OAuth callbacks on first load
  useEffect(() => { finishDropboxAuth() }, [])
  useEffect(() => { finishRedditAuth() }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      identifyUser(session?.user)
      if (session) {
        loadSettings()
        if (session.provider_token) captureDriveTokens()
        // Pull skills from Drive into the store. Runs in the background;
        // agents pick them up on the next system-prompt build.
        loadSkills()
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session)
        setUser(session?.user ?? null)
        identifyUser(session?.user)
        if (session) {
          loadSettings()
          if (session.provider_token) captureDriveTokens()
          loadSkills()
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  if (!user) return <AuthScreen />
  return <TheInterface />
}
