# Transactional email (Supabase Auth) — production setup

Supabase Auth (signup confirmation, magic link, password recovery) sends over SMTP.
The built-in Supabase sender is rate-limited (~a few/hour) and must not be used in
production. We route Supabase Auth through **Resend** (SMTP) on a dedicated sending
subdomain.

- **Provider:** Resend (`smtp.resend.com`)
- **Sending domain:** `mail.agentinterface.app` (subdomain keeps the root domain's
  reputation separate)
- **From:** `Agent Interface <noreply@mail.agentinterface.app>`
- **DNS:** managed in Cloudflare (zone `agentinterface.app`)

> The DKIM value below is **unique per domain** — copy the real one from the Resend
> dashboard when you add the domain. SPF/DMARC values are standard and shown verbatim.

## 1. Resend
1. Create a Resend account → **Domains → Add Domain** → enter `mail.agentinterface.app`
   (region **us-east-1** unless you have a reason to pick another — it changes the MX/SPF host).
2. Resend shows 3 records. Add them in Cloudflare (next section), then click **Verify**.
3. **API Keys → Create** an API key with **Sending access**. This `re_...` key is the
   SMTP password.

## 2. Cloudflare DNS (zone: agentinterface.app)

Add these in Cloudflare → DNS. All are non-proxied by nature (TXT/MX have no orange
cloud). In Cloudflare's **Name** field, enter the value relative to the zone (Cloudflare
appends `.agentinterface.app`), e.g. type `resend._domainkey.mail`.

| Type | Name (relative to agentinterface.app) | Value | Notes |
|------|----------------------------------------|-------|-------|
| TXT  | `resend._domainkey.mail` | `p=MIGf...` **(copy exact from Resend)** | DKIM public key (long; Cloudflare splits it automatically) |
| TXT  | `send.mail` | `v=spf1 include:amazonses.com ~all` | SPF for the Return-Path subdomain |
| MX   | `send.mail` | `feedback-smtp.us-east-1.amazonses.com` (priority `10`) | Bounce/feedback (Resend runs on SES) |
| TXT  | `_dmarc.mail` | `v=DMARC1; p=none; rua=mailto:dmarc@agentinterface.app` | DMARC; start with `p=none`, tighten later |

After the records propagate (usually minutes), hit **Verify** in Resend.

## 3. Supabase → Authentication → SMTP Settings → Enable Custom SMTP

| Field | Value |
|-------|-------|
| Sender email | `noreply@mail.agentinterface.app` |
| Sender name | `Agent Interface` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | *(the Resend `re_...` API key)* |

Then under **Authentication → Rate Limits**, raise the **email send rate** above the
tiny default (e.g. a few hundred/hour) so real signup volume isn't throttled.

## 4. Email template
Paste `supabase/email-templates/confirm-signup.html` into
**Authentication → Email Templates → Confirm signup** (or wire it via `config.toml`).
Keep the `{{ .ConfirmationURL }}` variable — it carries the verification token.

## 5. Verify it works
- Sign up with a real address you control → confirmation email should arrive within seconds,
  pass SPF/DKIM (check "show original" in Gmail → SPF=PASS, DKIM=PASS), and the button
  should confirm and sign you in.
- Resend dashboard → **Logs** shows delivery/opens and any bounces.
