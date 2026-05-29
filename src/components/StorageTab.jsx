import { useState, useEffect } from 'react'
import { supabase } from '../utils/supabase'
import { startDropboxAuth, dropboxConfigured } from '../utils/dropboxStorage'
import { setPrimaryProvider } from '../utils/cloudStorage'
import { useStore } from '../store/useStore'

const PROVIDERS = [
  {
    id:"google_drive",
    name:"Google Drive + Gmail",
    desc:"Save every output to your Drive. Same connection unlocks email sending via Gmail when the panel ships a deliverable.",
    icon:"🟢",
  },
  {
    id:"dropbox",
    name:"Dropbox",
    desc:"Same per-project folder structure, saved straight to your Dropbox.",
    icon:"🟦",
  },
]

export default function StorageTab() {
  const { settings, loadSettings } = useStore()
  const [connections, setConnections] = useState([])
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => { loadConnections() }, [])

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
    try {
      if (provider.id === "google_drive") {
        const { error: err } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: window.location.origin,
            scopes: [
              "https://www.googleapis.com/auth/drive.file",
              "https://www.googleapis.com/auth/gmail.send",
              "https://www.googleapis.com/auth/spreadsheets",
              "https://www.googleapis.com/auth/calendar.events",
            ].join(" "),
            queryParams: { access_type: "offline", prompt: "consent" },
          },
        })
        if (err) throw err
      } else if (provider.id === "dropbox") {
        if (!dropboxConfigured()) {
          setError("Dropbox isn't configured yet. You need to register a free Dropbox app at dropbox.com/developers, then paste its client ID into VITE_DROPBOX_CLIENT_ID in your environment.")
          setConnecting(null)
          return
        }
        await startDropboxAuth()
      }
    } catch (err) {
      setError(err.message || `Couldn't start ${provider.name} sign-in.`)
      setConnecting(null)
    }
  }

  const handleDisconnect = async (id, providerId) => {
    await supabase.from("storage_connections").delete().eq("id", id)
    setConnections(prev => prev.filter(c => c.id !== id))
    // If this was the primary, clear it
    if (settings?.primaryStorageProvider === providerId) {
      await setPrimaryProvider(null)
      loadSettings()
    }
  }

  const handleSetPrimary = async (providerId) => {
    await setPrimaryProvider(providerId)
    loadSettings()
  }

  const isConnected = (providerId) => connections.some(c => c.provider === providerId && c.access_token)
  const connectedCount = connections.filter(c => c.access_token).length
  const primary = settings?.primaryStorageProvider

  return (
    <div>
      <p className="settings-intro">
        Outputs from the panel — images, audio, video, generated docs — save directly to your cloud. We don't store anything. Your AI. Your keys. Your files.
      </p>

      {error && <div className="storage-error">{error}</div>}

      {PROVIDERS.map(provider => {
        const connected = isConnected(provider.id)
        const connection = connections.find(c => c.provider === provider.id)
        const isPrimary = primary === provider.id || (!primary && connected && connectedCount === 1)
        const isDropboxUnconfigured = provider.id === "dropbox" && !dropboxConfigured()
        return (
          <section className={`settings-card storage-card${connected ? " is-connected" : ""}${isPrimary ? " is-primary" : ""}`} key={provider.id}>
            <div className="settings-row">
              <div>
                <div className="settings-row-title">
                  <span className="storage-icon" aria-hidden>{provider.icon}</span>
                  {provider.name}
                  {connected && <span className="storage-badge">connected</span>}
                  {isPrimary && <span className="storage-badge storage-badge--primary">primary</span>}
                </div>
                <div className="settings-row-sub">{provider.desc}</div>
                {isDropboxUnconfigured && (
                  <div className="storage-sub-note">
                    Needs a free Dropbox app first. Register at <a href="https://www.dropbox.com/developers/apps" target="_blank" rel="noreferrer">dropbox.com/developers/apps</a>, then add the client ID to VITE_DROPBOX_CLIENT_ID.
                  </div>
                )}
              </div>
              {connected ? (
                <div className="storage-actions">
                  {!isPrimary && connectedCount > 1 && (
                    <button className="ai-btn" onClick={() => handleSetPrimary(provider.id)}>Make primary</button>
                  )}
                  <button className="ai-btn" onClick={() => handleDisconnect(connection.id, provider.id)}>Disconnect</button>
                </div>
              ) : (
                <button
                  className="ai-btn ai-btn--primary"
                  onClick={() => handleConnect(provider)}
                  disabled={connecting === provider.id || isDropboxUnconfigured}
                >{connecting === provider.id ? "Connecting…" : "Connect"}</button>
              )}
            </div>
          </section>
        )
      })}

      <section className="settings-card settings-card--quiet">
        <div className="settings-row-title">Your data promise</div>
        <p className="settings-helper">
          We never store your files. Everything saves directly to your connected storage.
          When you connect multiple providers, the "primary" one receives new outputs.
          You can disconnect anytime — your files stay where they are.
        </p>
      </section>

      <section className="settings-card settings-card--quiet">
        <div className="settings-row-title">More providers coming</div>
        <p className="settings-helper">
          OneDrive and WebDAV (Nextcloud, ownCloud) are on the roadmap. iCloud Drive
          can't be integrated directly — Apple doesn't publish a third-party API for
          personal iCloud.
        </p>
      </section>
    </div>
  )
}
