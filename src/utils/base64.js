// Base64-encode an ArrayBuffer safely.
//
// The tempting one-liner — btoa(String.fromCharCode(...new Uint8Array(buf))) —
// spreads every byte as a function argument and overflows the JS argument limit
// (~64k) on anything bigger than a tiny blob, throwing "Maximum call stack size
// exceeded". That crashed multi-second audio in the Worker and would crash any
// large file upload. Walk the bytes in 32KB windows instead.
//
// Use this everywhere instead of the spread form. (The Worker has its own copy,
// since it deploys as a separate bundle.)
export function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
