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

const CORE_VERSION = '0.12.10'
// Multiple CDNs for the ~25MB core. Relying on a single CDN (unpkg) made the
// whole video composer fail with "failed to import ffmpeg-core.js" whenever that
// CDN flaked or rate-limited — and ad_render never succeeded because of it. Try
// each CDN in turn; the first that loads wins. (ffmpeg's own docs recommend not
// depending on unpkg in production.)
const CORE_BASES = [
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd`,
  `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`,
  `https://esm.sh/@ffmpeg/core@${CORE_VERSION}/dist/umd`,
]

let _ffmpeg = null
let _loading = null

async function loadFromCdns() {
  let lastErr
  for (const base of CORE_BASES) {
    try {
      const ff = new FFmpeg()
      const [coreURL, wasmURL] = await Promise.all([
        toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
        toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
      ])
      await ff.load({ coreURL, wasmURL })
      return ff
    } catch (e) {
      lastErr = e
      // try the next CDN
    }
  }
  throw new Error(`ffmpeg core failed to load from all CDNs: ${lastErr?.message || lastErr}`)
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
    _loading = loadFromCdns()
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
