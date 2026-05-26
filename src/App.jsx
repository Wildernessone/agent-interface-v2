import { useEffect } from 'react'
import { supabase } from './utils/supabase'
import { useStore } from './store/useStore'
import { initTelemetry, identifyUser } from './utils/telemetry'
import AuthScreen from './components/AuthScreen'
import TheInterface from './components/TheInterface'
import './App.css'

initTelemetry()

export default function App() {
  const { user, setUser, setSession, loadSettings } = useStore()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      identifyUser(session?.user)
      if (session) loadSettings()
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session)
        setUser(session?.user ?? null)
        identifyUser(session?.user)
        if (session) loadSettings()
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  if (!user) return <AuthScreen />
  return <TheInterface />
}
