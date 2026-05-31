import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './App.css'
import App from './App.jsx'

// Self-heal stale lazy-chunk loads after a redeploy. A tab opened before a new
// deploy holds a module graph pointing at old hashed chunk URLs; when it later
// runs import('pptxgenjs')/import('docx') the old chunk 404s and the SPA
// fallback returns index.html (text/html), which the module loader rejects with
// "Expected a JavaScript module … MIME type text/html". Reload once (guarded
// against a loop) to pull the fresh index + chunk graph.
window.addEventListener('vite:preloadError', (e) => {
  const KEY = 'chunk-reload-at'
  const last = Number(sessionStorage.getItem(KEY) || 0)
  if (Date.now() - last > 10000) {
    sessionStorage.setItem(KEY, String(Date.now()))
    e.preventDefault()
    window.location.reload()
  }
})

// Default to dark theme; user preference can override later via settings
document.documentElement.dataset.theme = 'dark'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
