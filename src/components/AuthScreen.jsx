import { useState } from 'react'
import { supabase } from '../utils/supabase'

export default function AuthScreen() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState('')

  const handleEmail = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = mode === 'login'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  const handleOAuth = async (provider) => {
    setOauthLoading(provider)
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    })
  }

  const inp = { width:"100%", boxSizing:"border-box", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(99,102,241,0.2)", borderRadius:10, padding:"11px 14px", color:"rgba(255,255,255,0.9)", fontSize:14, fontFamily:"monospace", outline:"none", marginBottom:10 }

  return (
    <div style={{ minHeight:"100vh", background:"#080A0F", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div style={{ width:"100%", maxWidth:360, background:"#0E1117", border:"1px solid rgba(99,102,241,0.2)", borderRadius:22, padding:"36px 28px", boxShadow:"0 40px 80px rgba(0,0,0,0.6)" }}>
        <div style={{ textAlign:"center", marginBottom:28 }}>
          <div style={{ fontSize:22, fontWeight:700, color:"rgba(255,255,255,0.95)", marginBottom:4 }}>Agent Interface</div>
          <div style={{ fontSize:12, color:"rgba(255,255,255,0.35)", fontFamily:"monospace" }}>One interface. All your AI.</div>
        </div>
        <button onClick={() => handleOAuth("apple")} disabled={!!oauthLoading} style={{ width:"100%", padding:"12px 0", borderRadius:11, background:"rgba(255,255,255,0.96)", border:"none", color:"#000", fontSize:14, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:9, marginBottom:10, fontWeight:600 }}>
          {oauthLoading === "apple" ? "Redirecting..." : "Continue with Apple"}
        </button>
        <button onClick={() => handleOAuth("google")} disabled={!!oauthLoading} style={{ width:"100%", padding:"12px 0", borderRadius:11, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.14)", color:"rgba(255,255,255,0.9)", fontSize:14, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:9, marginBottom:20, fontWeight:600 }}>
          {oauthLoading === "google" ? "Redirecting..." : "Continue with Google"}
        </button>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
          <div style={{ flex:1, height:1, background:"rgba(255,255,255,0.08)" }}/>
          <span style={{ fontSize:11, color:"rgba(255,255,255,0.25)", fontFamily:"monospace" }}>or</span>
          <div style={{ flex:1, height:1, background:"rgba(255,255,255,0.08)" }}/>
        </div>
        <div style={{ display:"flex", background:"rgba(255,255,255,0.04)", borderRadius:10, padding:3, marginBottom:14 }}>
          {["login","signup"].map(m => (
            <button key={m} onClick={() => setMode(m)} style={{ flex:1, padding:"7px 0", borderRadius:8, border:"none", background:mode===m?"rgba(99,102,241,0.2)":"transparent", color:mode===m?"rgba(255,255,255,0.9)":"rgba(255,255,255,0.3)", cursor:"pointer", fontSize:12, fontFamily:"monospace" }}>
              {m === "login" ? "Sign In" : "Sign Up"}
            </button>
          ))}
        </div>
        <form onSubmit={handleEmail}>
          <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required style={inp}/>
          <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required style={{...inp, marginBottom: error ? 10 : 16}}/>
          {error && <div style={{ fontSize:12, color:"#F87171", marginBottom:12, fontFamily:"monospace" }}>{error}</div>}
          <button type="submit" disabled={loading} style={{ width:"100%", padding:"12px 0", borderRadius:11, background:"rgba(99,102,241,0.22)", border:"1px solid rgba(99,102,241,0.55)", color:"#a5b4fc", fontSize:14, cursor:"pointer", fontFamily:"monospace", fontWeight:600 }}>
            {loading ? "..." : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>
      </div>
    </div>
  )
}
