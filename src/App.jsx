import { useEffect } from 'react'
import { supabase } from './utils/supabase'
import { useStore } from './store/useStore'
import AuthScreen from './components/AuthScreen'
import TheInterface from './components/TheInterface'
import './App.css'

export default function App() {
  const { user, setUser, setSession, loadSettings } = useStore()

  useEffect(() => {
    // Check for existing session on load
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session) loadSettings()
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session)
        setUser(session?.user ?? null)
        if (session) loadSettings()
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  if (!user) return <AuthScreen />
  return <TheInterface />
}
