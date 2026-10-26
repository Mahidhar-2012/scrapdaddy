# ScrapDaddy — deployment

The app is in two parts:

| Part | What it is | Where it can live |
|---|---|---|
| **Front end** | `index.html`, `styles.css`, `js/`, `data/` — plain static files | Anywhere. Currently GitHub Pages. |
| **Back end** | `api/` — Node functions holding the API keys | A host that runs server code (Vercel, Netlify, Cloudflare). |

The front end works on its own. Without a back end, photo analysis, the
assistant and payments report themselves as unavailable — nothing is faked.

---

## Option A — keep GitHub Pages, add a backend elsewhere (least disruption)

Your current URL stays the same. Only the `api/` folder goes somewhere else.

1. **Deploy the backend to Vercel**
   - Sign in at [vercel.com](https://vercel.com) with GitHub.
   - *Add New → Project* → import `Mahidhar-2012/scrapdaddy` → Deploy.
   - It will serve the whole repo; you will use only its `/api` routes.
2. **Add the keys** — Project → Settings → Environment Variables. Copy the
   names from [`.env.example`](.env.example). At minimum:
   - `OPENAI_API_KEY` — photo analysis
   - `GROQ_API_KEY` — assistant
   - `ALLOWED_ORIGINS` — set to `https://mahidhar-2012.github.io`
3. **Redeploy** so the variables take effect.
4. **Point the app at it** — open ScrapDaddy, sign in as an administrator, go to
   **Settings → Integrations**, enter `https://<your-project>.vercel.app/api`
   and press **Save and test**. The panel reports, per provider, whether the key
   works and whether the model is actually available to it.

That address is stored per browser. Every user who wants the AI features would
need to set it, so for anything beyond a demo use Option B.

## Option B — move the whole site to Vercel

Everything on one origin; no `ALLOWED_ORIGINS` and no Integrations setting
needed. Your URL changes to `https://<project>.vercel.app`.

1. Import the repo on Vercel as above.
2. Add the environment variables.
3. Leave **Settings → Integrations** blank — the app finds `/api` on its own.
4. Optional: turn GitHub Pages off so there is only one live copy.

## Option C — Cloudflare Pages or Netlify

Both work; the handler signature differs.

- **Netlify** — move `api/*.js` to `netlify/functions/`, and add
  `[[redirects]] from = "/api/*" to = "/.netlify/functions/:splat"` to `netlify.toml`.
- **Cloudflare Pages** — move them to `functions/api/` and change each
  `module.exports = handler([...], fn)` to an `onRequest` export. The provider
  calls themselves are unchanged.

---

## Local development

```bash
node dev-server.js          # http://localhost:3000
```

Put your keys in `.env.local` (git-ignored). Check what is configured:

```bash
curl http://localhost:3000/api/health | python -m json.tool
curl "http://localhost:3000/api/health?probe=1"   # also asks the providers
```

---

## Choosing models

Both provider catalogues change. The defaults are set in `api/_lib/config.js`
and can be overridden without touching code:

| Variable | Default | Alternatives |
|---|---|---|
| `OPENAI_VISION_MODEL` | `gpt-6.1-sol` | `gpt-6-astra` (most capable), `gpt-6-luna` (cheapest) |
| `GROQ_CHAT_MODEL` | `openai/gpt-oss-20b` | `openai/gpt-oss-120b`, `llama-3.3-70b-versatile`, `llama-3.1-8b-instant` |

`GET /api/health?probe=1` lists what your key can actually reach, and the
Integrations panel shows the same thing. If a model has been retired, that is
where you will see it.

---

## Costs

Per photo analysed: roughly 1,000–1,500 input tokens plus about 400 output.
On `gpt-6.1-sol` ($2 / $10 per million) that is well under a rupee per scan;
`gpt-6-luna` is about twenty times cheaper. Groq's free tier covers light
assistant use. Per-IP hourly caps are set with `SCAN_RATE_PER_HOUR` and
`CHAT_RATE_PER_HOUR`.

---

## Still required before real money moves

Payments are **wired but not finishable** as things stand:

- `api/billing/create-order.js` creates a real Razorpay order once
  `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are set.
- `api/billing/webhook.js` verifies Razorpay's signature correctly.
- **But there is nowhere to record the result.** Subscription state lives in
  each browser, which a webhook cannot reach, so a verified payment is logged
  and acknowledged without activating anything.

To finish it you need a database (Postgres, Supabase, Vercel KV, D1 …), then:

1. Set `SUBSCRIPTION_STORE_URL` and implement `persistSubscription()`.
2. Make it idempotent on the Razorpay event id — webhooks are retried.
3. Change `Subscriptions.forVendor()` in `js/subscriptions.js` to read from
   that store instead of `localStorage`.

Until then the app keeps paid plans in `pending_payment`, grants no paid
entitlements, and says so on the billing page.

The same database is what accounts need to stop being per-browser. See the
provider interface at the top of `js/auth.js`.

---

## Security checklist

- [ ] `.env*` is git-ignored (`.env.example` excepted) — already set up
- [ ] Keys are set as host environment variables, never in the repo
- [ ] `ALLOWED_ORIGINS` is set in production
- [ ] The default admin password `ScrapAdmin!2026` has been changed
- [ ] Rate limits reviewed — the in-memory limiter is best effort only, see
      `api/_lib/ratelimit.js`
