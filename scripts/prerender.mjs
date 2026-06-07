// Build-time prerender of the landing route ("/") into static HTML.
//
// This is a SPA (createRoot().render(), not hydrateRoot), so crawlers that
// don't execute JS — and the very first paint for everyone — otherwise see an
// empty <div id="root">. Here we render <Landing/> to static markup with React
// on the server and inject it into dist/index.html, so the full landing copy
// ships in the initial HTML response. React then mounts on top client-side
// (it replaces the container content — no hydration, so no route mismatch when
// the same index.html is served for /app or /login via the SPA fallback).
//
// Uses Vite's SSR module loader so JSX + CSS imports resolve exactly as in the
// app build — no separate SSR bundle/config. Runs offline (no network), so it's
// safe in CI right after `vite build`.
import { createServer } from 'vite'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { StaticRouter } from 'react-router-dom'
import { readFileSync, writeFileSync } from 'node:fs'

const INDEX = new URL('../dist/index.html', import.meta.url)
const ROOT_DIV = '<div id="root"></div>'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
try {
  const { default: Landing } = await vite.ssrLoadModule('/src/components/Landing.jsx')
  const markup = renderToStaticMarkup(
    createElement(StaticRouter, { location: '/' }, createElement(Landing)),
  )

  let doc = readFileSync(INDEX, 'utf8')
  if (!doc.includes(ROOT_DIV)) throw new Error(`prerender: "${ROOT_DIV}" not found in dist/index.html`)

  // Inject the landing markup, and a tiny guard that clears it instantly for
  // non-root paths (the SPA fallback serves this same index.html for /app and
  // /login — without the guard those would flash the landing before React
  // mounts). The inline script runs during parse, before first paint.
  const guard = `<script>if(location.pathname!=='/')document.getElementById('root').textContent=''</script>`
  doc = doc.replace(ROOT_DIV, `<div id="root">${markup}</div>\n    ${guard}`)
  writeFileSync(INDEX, doc)
  console.log(`prerendered landing → dist/index.html (+${markup.length.toLocaleString()} chars of static HTML)`)
} finally {
  await vite.close()
}
