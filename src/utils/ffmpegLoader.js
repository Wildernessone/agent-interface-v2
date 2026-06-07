// ── ffmpeg.wasm loader ─────────────────────────────────────────────
// Lazy, single-instance loader for the browser-side video/audio
// composers (narrated_deck, future audio_mix / video_stitch).
//
// We deliberately use the SINGLE-THREADED core (@ffmpeg/core, not -mt).
// The multithreaded core needs SharedArrayBuffer, which requires the page
// to be cross-origin isolated (COOP + COEP: require-corp). Turning that on
// site-wide would break the app's many cross-origin <img>/<audio> loads
// (DALL·E, Flux, Drive thumbnails…). Single-threaded is slower but needs
// no special headers and won't regress anything. If we ever want the speed,
// COEP: credentialless + the -mt core is the upgrade path.
//
// The wasm core (~25MB) is fetched from the CDN only the first time a
// composer actually runs — it is never part of the main bundle.
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL, fetchFile } from '@ffmpeg/util'
// SELF-HOSTED core, served by OUR claude-proxy worker (/ffmpeg-core.js + .wasm).
// The worker fetches the core from jsDelivr SERVER-SIDE (Cloudflare→CDN is far
// more reliable than browser→CDN) and edge-caches it, so the browser always gets
// it from a stable, fast, first-party endpoint. This is the durable fix for the
// "failed to import ffmpeg-core.js" failures that killed every ad_render — no
// flaky browser-CDN dependency. (We can't ship the 30 MiB wasm as a Pages asset:
// Cloudflare Pages rejects files >25 MiB.) Public CDNs remain a last-ditch
// fallback if the worker is unreachable.
const PROXY = import.meta.env.VITE_PROXY_URL || 'https://claude-proxy.jamesreed.workers.dev'
const coreAssetURL = `${PROXY}/ffmpeg-core.js`
const wasmAssetURL = `${PROXY}/ffmpeg-core.wasm`

const CORE_VERSION = '0.12.10'
const CORE_BASES = [
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd`,
  `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`,
]

let _ffmpeg = null
let _loading = null

async function loadFrom(coreSrc, wasmSrc) {
  const ff = new FFmpeg()
  const [coreURL, wasmURL] = await Promise.all([
    toBlobURL(coreSrc, 'text/javascript'),
    toBlobURL(wasmSrc, 'application/wasm'),
  ])
  await ff.load({ coreURL, wasmURL })
  return ff
}

async function loadCore() {
  // 1) bundled, same-origin (the reliable path).
  try {
    return await loadFrom(coreAssetURL, wasmAssetURL)
  } catch (bundledErr) {
    // 2) CDN fallback, only if the same-origin asset somehow failed.
    let lastErr = bundledErr
    for (const base of CORE_BASES) {
      try {
        return await loadFrom(`${base}/ffmpeg-core.js`, `${base}/ffmpeg-core.wasm`)
      } catch (e) { lastErr = e }
    }
    throw new Error(`ffmpeg core failed to load (bundled + CDNs): ${lastErr?.message || lastErr}`)
  }
}

/**
 * Get the shared FFmpeg instance, loading the core on first use.
 * @param {(ratio:number)=>void} [onProgress] 0..1 transcode progress
 */
export async function getFFmpeg(onProgress) {
  if (_ffmpeg) {
    if (onProgress) attachProgress(_ffmpeg, onProgress)
    return _ffmpeg
  }
  if (!_loading) {
    _loading = loadCore()
      .then(ff => { _ffmpeg = ff; return ff })
      .catch(e => { _loading = null; throw e }) // allow a later retry
  }
  const ff = await _loading
  if (onProgress) attachProgress(ff, onProgress)
  return ff
}

// Replace any prior progress handler with the current build's so progress
// doesn't leak between sequential composer runs.
let _progressHandler = null
function attachProgress(ff, onProgress) {
  if (_progressHandler) ff.off('progress', _progressHandler)
  _progressHandler = ({ progress }) => onProgress(Math.max(0, Math.min(1, progress)))
  ff.on('progress', _progressHandler)
}

export { fetchFile }
