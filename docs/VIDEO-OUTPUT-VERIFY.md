# Verify video output (ad_render MP4) — real-browser test

The one piece of the video pipeline that **automation can't confirm**: whether
`ad_render`'s ffmpeg.wasm core instantiates and produces a real `.mp4` in a
genuine browser. Headless Chromium can't (a known limitation); real browsers
can. This runbook is the definitive manual check.

## Pre-flight (verified green 2026-06-07)
- ffmpeg core served live by the worker — both 200:
  - `https://claude-proxy.jamesreed.workers.dev/ffmpeg-core.js` (~112 KB)
  - `https://claude-proxy.jamesreed.workers.dev/ffmpeg-core.wasm` (~32 MB)
  - The loader (`src/utils/ffmpegLoader.js`) hits this first-party endpoint
    before any CDN, so the old "failed to import ffmpeg-core.js" flake is gone.
- `ad_render` is keyless and is the default finisher; it returns a real
  `data:video/mp4` the app plays inline (registry.js → `ad_render`).

## Keys you need set (Settings → keys) — BYOK
`ad_render` needs no key, but its INPUTS do:
- image-gen key (gpt-image-1 / Stability / Ideogram) → the hero frame
- ElevenLabs key → the voiceover
- (optional) Stable Audio → backing music

## The test build — simplest reliable path
A short promo (≤10s) feeds ONE hero image + voiceover straight into `ad_render`
(fewest moving parts; no multi-frame storyboard to flake).

1. Open **agentinterface.app**, log in.
2. Use a project that has a **brand brief** — the **Timberline v2 project** has
   one. (Video/ad builds are brand-gated; with no brief OpenClaw asks for one
   instead of building. Or paste a brief into the message.)
3. **Open DevTools (F12) → Console + Network BEFORE sending** — so a failure is
   already captured.
4. Send: **"Make me a 10-second promo video about [the product]."**

## Pass criteria
- Steps run: copy → hero image → voiceover → **ad_render** (watch Network for
  the `ffmpeg-core.wasm` fetch from `claude-proxy` on first render).
- The finished deliverable is a **playable .mp4** at the top of the build kit.
  **Play it** — you see the frame(s) and HEAR the voiceover. That's the pass.

## If it fails — capture these three
1. In-app error line: `Couldn't render the ad: … — ffmpeg: <detail>`
2. F12 Console red error (esp. anything naming `ffmpeg-core` or `ff.load`)
3. Network status of the two `ffmpeg-core` requests (200? blocked? CORS?)

That trio pins the cause immediately.
