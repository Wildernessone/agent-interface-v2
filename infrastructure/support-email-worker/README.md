# support-email worker

Cloudflare **Email Worker** that turns `support@agentinterface.app` into rows in
the HUB Supabase `support_messages` table. Command Center reads that table and
shows an unread badge — support mail lands in the admin dashboard in real time,
no Gmail/scraper/cron. No inbox forward (the message is consumed here).

## One-time deploy

```bash
cd infrastructure/support-email-worker
npm install
npx wrangler deploy
```
No secret needed — `HUB_KEY` (publishable key) is a public var in `wrangler.toml`; it only has INSERT on `support_messages`.

## Wire it to email (Cloudflare dashboard)

1. dash.cloudflare.com → **agentinterface.app** zone → **Email → Email Routing**.
2. If not already on: **Enable** Email Routing (accept the DNS records it adds;
   let it replace the old `eforward*` MX records).
3. **Routing rules → Custom addresses → Create address**:
   - Address: `support@agentinterface.app`
   - Action: **Send to a Worker** → `support-email`
4. Send a test email to `support@agentinterface.app` → it should appear in
   Command Center within seconds.

## Notes
- The worker rejects (5xx → sender retries) if the DB write fails, so mail is
  never silently lost.
- To also keep a readable copy in an inbox later, add `message.forward('you@example.com')`
  in `worker.js` (the address must be a verified Email Routing destination).
