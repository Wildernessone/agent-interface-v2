import { useState, useEffect } from 'react'
import { supabase } from '../utils/supabase'

const PROVIDERS = [
  { id:"google_drive", name:"Google Drive", desc:"Save all project outputs automatically" },
]

export default function StorageTab() {
  const [connections, setConnections] = useState([])
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    loadConnections()
  }, [])

  const loadConnections = async () => {
    setError(null)
    const { data, error: err } = await supabase.from("storage_connections").select("*")
    if (err) setError("Couldn't load storage connections. Try refreshing.")
    setConnections(data || [])
    setLoading(false)
  }

  const handleConnect = async (provider) => {
    setError(null)
    setConnecting(provider.id)
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
        scopes: "https://www.googleapis.com/auth/drive.file",
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    })
    if (err) {
      setError(err.message || "Couldn't start Google sign-in. Check that Google OAuth is enabled in Supabase.")
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
      <p className="settings-intro">
        Connect cloud storage. Every output — images, audio, video, docs — saves directly there. You own everything.
      </p>

      {error && (
        <div className="storage-error">{error}</div>
      )}

      {PROVIDERS.map(provider => {
        const connected = isConnected(provider.id)
        const connection = connections.find(c => c.provider === provider.id)
        return (
          <section className={`settings-card storage-card${connected ? " is-connected" : ""}`} key={provider.id}>
            <div className="settings-row">
              <div>
                <div className="settings-row-title">
                  {provider.name}
                  {connected && <span className="storage-badge">connected</span>}
                </div>
                <div className="settings-row-sub">{provider.desc}</div>
              </div>
              {connected ? (
                <button className="ai-btn" onClick={() => handleDisconnect(connection.id)}>Disconnect</button>
              ) : (
                <button
                  className="ai-btn ai-btn--primary"
                  onClick={() => handleConnect(provider)}
                  disabled={connecting === provider.id}
                >{connecting === provider.id ? "Connecting…" : "Connect"}</button>
              )}
            </div>
            {connected && connection?.root_folder_id && (
              <div className="storage-folder">Agent Interface folder created in your Drive</div>
            )}
          </section>
        )
      })}

      <section className="settings-card settings-card--quiet">
        <div className="settings-row-title">Your data promise</div>
        <p className="settings-helper">
          We never store your files. Everything saves directly to your connected storage. Your AI. Your keys. Your files. Always.
        </p>
      </section>
    </div>
  )
}
