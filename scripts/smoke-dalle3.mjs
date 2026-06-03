// dall-e-3 image-route smoke test.
//
// The bug: the /dalle worker route hardcoded gpt-image-1, which 403s unless the
// OpenAI org is ID-verified — silently killing every ad / per-slide image
// build. Fix: default to dall-e-3 (no verification) and translate the request.
//
// Part 1 unit-tests the worker's pure buildImageRequest() mapping (imported
// directly — no Cloudflare runtime needed). Part 2 confirms image_per_slide
// still parses a dall-e-3 b64_json bundle via the real tool through Vite SSR.
import { createServer } from 'vite'
import { buildImageRequest } from '../infrastructure/cloudflare-proxy/worker.js'

let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

// ── Part 1: worker request mapping ──────────────────────────────────
const def = buildImageRequest({ prompt: 'a fox', size: '1024x1024', quality: 'high' })
check('default model is dall-e-3 (no org verification)', def.model === 'dall-e-3', def.model)
check('forces b64_json so the build pipeline gets a data: image', def.response_format === 'b64_json')
check('high quality maps to hd', def.quality === 'hd', def.quality)
check('n is 1 (dall-e-3 only supports one)', def.n === 1)

check('legacy gpt-image-1 wide 1536x1024 → dall-e-3 1792x1024',
  buildImageRequest({ size: '1536x1024' }).size === '1792x1024')
check('legacy gpt-image-1 tall 1024x1536 → dall-e-3 1024x1792',
  buildImageRequest({ size: '1024x1536' }).size === '1024x1792')
check('native dall-e-3 wide 1792x1024 passes through',
  buildImageRequest({ size: '1792x1024' }).size === '1792x1024')
check('unknown size falls back to square', buildImageRequest({ size: 'bogus' }).size === '1024x1024')
check('medium/low quality → standard', buildImageRequest({ quality: 'low' }).quality === 'standard')

const gpt = buildImageRequest({ prompt: 'x', size: '1536x1024', quality: 'high', model: 'gpt-image-1' })
check('explicit model gpt-image-1 still honored (verified orgs)', gpt.model === 'gpt-image-1', gpt.model)
check('gpt-image-1 keeps its native size', gpt.size === '1536x1024', gpt.size)
check('gpt-image-1 omits response_format (it rejects the param)', !('response_format' in gpt))

// ── Part 2: image_per_slide parses a dall-e-3 b64 bundle ────────────
const server = await createServer({ root: process.cwd(), logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })
try {
  const { TOOLS_BY_ID } = await server.ssrLoadModule('/src/tools/registry.js')
  // dall-e-3 with response_format:b64_json returns { data: [{ b64_json }] }.
  const proxy = async () => ({ ok: true, status: 200, json: async () => ({ data: [{ b64_json: 'QUJD' }] }), text: async () => '' })
  const out = await TOOLS_BY_ID['image_per_slide'].run({
    structuredInput: { slides: [{ title: 'A', prompt: 'a fox' }, { title: 'B', prompt: 'a hen' }], size: 'wide' },
    key: 'sk-openai', proxy,
  })
  check('image_per_slide returns an image_bundle', out?.type === 'image_bundle')
  check('both slides produced inline data: images', out.files.length === 2 && out.files.every(f => f.url?.startsWith('data:image/png;base64,')),
    out.files.map(f => f.url?.slice(0, 24)).join(', '))
  check('size resolved to dall-e-3 wide', out.meta?.size === '1792x1024', out.meta?.size)
} catch (e) {
  check('harness ran without throwing', false, e.stack || e.message)
} finally {
  await server.close()
}

console.log(`\n${failures === 0 ? '✅ ALL PASSED' : `❌ ${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
