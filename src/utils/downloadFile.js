// DOWNLOAD FILE — reliable save across desktop AND mobile.
// ========================================================
// Build deliverables are `data:` URLs. A plain `<a download href="data:…">`
// works on desktop but iOS Safari IGNORES the download attribute on data URLs —
// it opens the file in-page instead of saving, so "download" appeared broken on
// mobile. This decodes the data URL to a Blob and:
//   • mobile (share-capable) → navigator.share({files}) → the native share sheet
//     with "Save to Files" / Drive / etc. (the only real way to save arbitrary
//     files on iOS). Called synchronously in the click gesture so iOS allows it.
//   • otherwise → a blob: URL + anchor download (desktop + Android, reliable).
// Hosted http(s) URLs (e.g. a rendered video) fall through to a normal anchor.

function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(',')
  const meta = dataUrl.slice(5, comma)            // strip "data:"
  const mime = meta.split(';')[0] || 'application/octet-stream'
  const payload = dataUrl.slice(comma + 1)
  if (/;base64/i.test(meta)) {
    const bin = atob(payload)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: mime })
  }
  return new Blob([decodeURIComponent(payload)], { type: mime })
}

function blobAnchor(blob, filename) {
  const objUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objUrl
  a.download = filename || 'download'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(objUrl), 15000)
}

export function downloadFile(url, filename) {
  const name = filename || 'download'
  try {
    if (url.startsWith('data:')) {
      const blob = dataUrlToBlob(url)
      const file = new File([blob], name, { type: blob.type || 'application/octet-stream' })
      // Prefer the native share sheet on mobile — it's the only path to "Save to
      // Files" on iOS. MUST be invoked synchronously here (no await) to stay
      // inside the click gesture, or iOS throws NotAllowedError.
      if (typeof navigator !== 'undefined' && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: name }).catch(err => {
          if (err && err.name === 'AbortError') return   // user dismissed the sheet
          blobAnchor(blob, name)                          // share failed → save directly
        })
        return
      }
      blobAnchor(blob, name)
      return
    }
    // Hosted / blob URL — a normal anchor download (cross-origin download attr is
    // advisory, but the browser can still save / open it).
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.target = '_blank'
    a.rel = 'noreferrer'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } catch {
    try { window.open(url, '_blank') } catch { /* nothing more we can do */ }
  }
}
