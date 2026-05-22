import { useState, useEffect } from 'react'
import { supabase } from '../utils/supabase'

const PROVIDERS = [
  { id:"google_drive", name:"Google Drive", icon:"📁", desc:"Connect your Google Drive to save all project outputs automatically", color:"#4285F4" },
  { id:"dropbox", name:"Dropbox", icon:"📦", desc:"Coming soon", color:"#0061FF", soon:true },
  { id:"onedrive", name:"OneDrive", icon:"☁️", desc:"Coming soon", color:"#0078D4", soon:true },
]

export default function StorageTab({ accent, theme, ss }) {
  const [connections, setConnections] = useState([])
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(null)

  const th = theme || {
    text: "rgba(255,255,255,0.88)",
    textMuted: "rgba(255,255,255,0.42)",
    textFaint: "rgba(255,255,255,0.18)",
    border: "rgba(99,102,241,0.15)",
    surface: "rgba(255,255,255,0.04)",
  }

  useEffect(() => {
    loadConnections()
  }, [])

  const loadConnections = async () => {
    try {
      const { data } = await supabase.from("storage_connections").select("*")
      setConnections(data || [])
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  const handleConnect = async (provider) => {
    if (provider.soon) return
    setConnecting(provider.id)
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
          scopes: "https://www.googleapis.com/auth/drive.file",
          queryParams: { access_type: "offline", prompt: "consent" }
        }
      })
      if (error) throw error
    } catch(e) {
      console.error("Connect error:", e)
      setConnecting(null)
    }
  }

  const handleDisconnect = async (id) => {
    await supabase.from("storage_connections").delete().eq("id", id)
    setConnections(prev => prev.filter(c => c.id !== id))
  }

  const isConnected = (providerId) => connections.some(c => c.provider === providerId)

  return (
    <div>
      <div style={{ fontSize:11, color:th.textMuted, fontFamily:"monospace", marginBottom:16, lineHeight:1.6 }}>
        Connect your cloud storage. All project outputs — images, documents, audio, video — save directly to your storage. You own everything.
      </div>

      {/* Provider cards */}
      {PROVIDERS.map(provider => {
        const connected = isConnected(provider.id)
        const connection = connections.find(c => c.provider === provider.id)
        return (
          <div key={provider.id} style={{ background:"rgba(255,255,255,0.03)", border:`1px solid ${connected?accent+"44":"rgba(255,255,255,0.08)"}`, borderRadius:14, padding:"14px 16px", marginBottom:10 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ fontSize:24 }}>{provider.icon}</div>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:th.text, display:"flex", alignItems:"center", gap:6 }}>
                    {provider.name}
                    {provider.soon && <span style={{ fontSize:9, color:th.textFaint, fontFamily:"monospace", background:"rgba(255,255,255,0.06)", padding:"2px 6px", borderRadius:10 }}>soon</span>}
                    {connected && <span style={{ fontSize:9, color:"#74C69D", fontFamily:"monospace" }}>✓ connected</span>}
                  </div>
                  <div style={{ fontSize:10, color:th.textFaint, marginTop:2 }}>{provider.desc}</div>
                </div>
              </div>
              {!provider.soon && (
                connected ? (
                  <button onClick={() => handleDisconnect(connection.id)} style={{ padding:"5px 12px", borderRadius:8, background:"rgba(248,113,113,0.1)", border:"1px solid rgba(248,113,113,0.25)", color:"#F87171", fontSize:11, cursor:"pointer", fontFamily:"monospace" }}>Disconnect</button>
                ) : (
                  <button onClick={() => handleConnect(provider)} disabled={connecting === provider.id} style={{ padding:"5px 12px", borderRadius:8, background:`${accent}18`, border:`1px solid ${accent}44`, color:accent, fontSize:11, cursor:"pointer", fontFamily:"monospace" }}>
                    {connecting === provider.id ? "Connecting..." : "Connect →"}
                  </button>
                )
              )}
            </div>
            {connected && connection?.root_folder_id && (
              <div style={{ marginTop:10, padding:"8px 12px", background:"rgba(255,255,255,0.03)", borderRadius:8, fontSize:10, color:th.textFaint, fontFamily:"monospace" }}>
                📁 Agent Interface folder created in your Drive
              </div>
            )}
          </div>
        )
      })}

      <div style={{ marginTop:16, padding:"12px 14px", background:"rgba(255,255,255,0.03)", borderRadius:10, border:"1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ fontSize:11, fontWeight:600, color:th.textMuted, marginBottom:6 }}>Your data promise</div>
        <div style={{ fontSize:10, color:th.textFaint, lineHeight:1.6 }}>
          We never store your files. Everything saves directly to your connected storage. 
          Your AI. Your keys. Your files. Always.
        </div>
      </div>
    </div>
  )
}
