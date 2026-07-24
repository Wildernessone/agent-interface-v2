// Serve the SPA shell (the "/" asset) under a client-side route's path.
//
// The "/* /index.html 200" catch-all in _redirects is gone — it made every
// nonexistent URL answer 200 with the full landing page (a soft-404 Google
// penalizes; SideWRK had the same bug). But the SPA's pathname routes
// (/app, /login, /studio, /council) still need the shell served at their
// path, and a "/app /index.html 200" rewrite does NOT work as a replacement:
// Pages canonicalizes /index.html to / and answers with a 308, so the route
// never boots. Fetching the asset at "/" and returning its body under the
// requested path sidesteps that normalization.
//
// Hardening copied from the proven SideWRK /demo function:
// - never forward conditional headers (a 304 has an empty body → white screen)
// - buffer the body (a streamed clone can be cached truncated)
// - pin Content-Type/Length so a mis-negotiated edge variant can't download
export async function serveShell(context) {
  const url = new URL(context.request.url);
  url.pathname = "/";
  const req = new Request(url.toString(), { headers: { Accept: "text/html" } });
  const res = await context.env.ASSETS.fetch(req);
  const body = await res.arrayBuffer();
  const headers = new Headers(res.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Content-Length", String(body.byteLength));
  headers.set("Cache-Control", "no-store");
  headers.delete("Content-Disposition");
  return new Response(body, { status: 200, headers });
}
