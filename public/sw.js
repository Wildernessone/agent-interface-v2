// Minimal service worker — its job is to make Agent Interface INSTALLABLE
// (PWA / Android TWA), not to cache the app. It deliberately does NOT cache
// HTML or JS so users always get the latest Cloudflare Pages deploy (a caching
// SW on a fast-moving SPA is how you ship stale builds to people). Chrome's
// installability criteria only require a registered SW with a fetch handler.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
// Pass-through: let the network handle every request (no offline cache).
self.addEventListener('fetch', () => {})
