# KVitae — CV Manager (Hono + Cloudflare Workers)

Serverless CV backend on Cloudflare Workers with KV (JSON data) and R2 (HTML/assets).

**Author:** [Arthur Rahimov](https://github.com/ragmon)  
**License:** [MIT](./LICENSE)

## Data flow: PocketBase is the source of truth

This Worker serves a **published snapshot**. The CV data itself is managed in
[custom-pocketbase](https://github.com/Rahimov-Development/custom-pocketbase)
(`pb.rahimov.dev`), which owns the relational CV collections:

1. Edit profile / experiences / skills in the PocketBase dashboard.
2. Preview the draft: `GET /api/personal/cv` on PocketBase (superuser).
3. Publish on demand: `POST /api/personal/cv/publish` on PocketBase (superuser).
   It composes the CV, `PUT`s the JSON to this Worker's `/api/cv` (KV) and
   uploads the avatar to `/media/avatar.*` (R2). Use the env-based helper in
   custom-pocketbase (`scripts/publish-cv.sh`) — do not keep a local
   `publish.sh` with credentials in this repo.

Nothing auto-syncs: PocketBase's Redis `cv.updated` events only invalidate its
composed-CV cache. Hand-editing `cv.json` and `PUT`-ing it still works, but
PocketBase is authoritative — prefer editing there and re-publishing.

Secrets the PocketBase side needs (its `.env`, see that repo's `.env.example`):

| Variable | Value |
|----------|-------|
| `KVITAE_URL` | `https://cv-manager.arthur-ragimov.workers.dev` |
| `KVITAE_AUTH_SECRET` | This Worker's `AUTH_SECRET` |
| `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` | Access service token (required while `workers.dev` is behind Cloudflare Access) |

Publish from the PocketBase repo (credentials via env or that repo’s `.env`, never hardcoded):

```bash
cd ../custom-pocketbase
PB_URL=https://pb.rahimov.dev \
PB_SUPERUSER_EMAIL=you@example.com PB_SUPERUSER_PASSWORD='...' \
./scripts/publish-cv.sh
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create the KV namespace

```bash
npx wrangler kv namespace create CV_STORAGE
```

Copy the `id` from the terminal output into `wrangler.jsonc` under `kv_namespaces`.

### 3. Create the R2 bucket

```bash
npx wrangler r2 bucket create cv-assets
```

### 4. Set the authentication secret

```bash
npx wrangler secret put AUTH_SECRET
```

For local development:

```bash
cp .dev.vars.example .dev.vars
# edit AUTH_SECRET in .dev.vars
```

### 5. Deploy

```bash
npx wrangler deploy
```

Local:

```bash
npm run dev
```

## CI/CD (GitHub Actions)

On every push to `main`, `.github/workflows/deploy.yml` deploys the Worker with Wrangler.

### Required repository secrets

| Secret | Value |
|--------|--------|
| `CLOUDFLARE_API_TOKEN` | API token with **Workers Scripts Edit**, **Account Settings Read**, **Workers KV Storage Edit**, **Workers R2 Storage Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | `b21935a261bd227400d32c634a32fc20` |

Create a token: [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) → **Create Token** → use the **Edit Cloudflare Workers** template (or custom with the permissions above).

Then set secrets:

```bash
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID --body "b21935a261bd227400d32c634a32fc20"
```

Manual deploy from Actions: **Actions** → **Deploy** → **Run workflow**.

## Cloudflare Access (private browsing)

Protect `workers.dev` so only your email can open the CV in a browser.

### 1. Enable Access on the Worker

1. Open [cv-manager → Settings → Domains & Routes](https://dash.cloudflare.com/b21935a261bd227400d32c634a32fc20/workers/services/view/cv-manager/production/settings)
2. On the `workers.dev` row, click **Enable Cloudflare Access**
3. Click **Manage Cloudflare Access** and allow only your email (e.g. `arthur.ragimov@gmail.com`)
4. Copy **Application Audience (AUD)** and **Team domain** from the Access UI

### 2. Set Worker vars (then redeploy)

```bash
npx wrangler secret put POLICY_AUD   # optional: can also be a plain var
# or add to wrangler.jsonc under "vars":
```

```jsonc
"vars": {
  "POLICY_AUD": "<AUD from Access>",
  "TEAM_DOMAIN": "https://<your-team>.cloudflareaccess.com"
}
```

With both set, the Worker also verifies the Access JWT (`Cf-Access-Jwt-Assertion`).

### 3. API / curl after Access is on

Browser login does not apply to `curl`. Create a [Service Token](https://one.dash.cloudflare.com/) under **Access → Service Auth**, attach it to the Access policy, then:

```bash
curl -X PUT https://cv-manager.arthur-ragimov.workers.dev/api/cv \
  -H "CF-Access-Client-Id: YOUR_SERVICE_TOKEN_ID" \
  -H "CF-Access-Client-Secret: YOUR_SERVICE_TOKEN_SECRET" \
  -H "Authorization: Bearer YOUR_AUTH_SECRET" \
  -H "Content-Type: application/json" \
  --data-binary @cv.json
```

## CV content

| File | Purpose |
|------|---------|
| `templates/index.html` | Sanitized HTML shell (no personal data). Renders from `window.__CV_DATA__`. |
| `cv.example.json` | Sanitized sample payload (KV uploads and PocketBase seed). |
| `cv.json` | **Your private CV data** — gitignored. Copy from the example and fill in locally. Also the preferred input for `custom-pocketbase` `scripts/seed-cv.mjs` (that script clears CV collections then recreates). |

```bash
cp cv.example.json cv.json
# edit cv.json with your real data (never commit it)
```

Upload the template and JSON to the live Worker:

```bash
curl -X PUT https://your-worker-url.workers.dev/media/index.html \
  -H "Authorization: Bearer YOUR_SECRET_TOKEN" \
  -H "Content-Type: text/html" \
  --data-binary @templates/index.html

curl -X PUT https://your-worker-url.workers.dev/api/cv \
  -H "Authorization: Bearer YOUR_SECRET_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @cv.json
```

The public page has a light/dark theme toggle (persisted in `localStorage`) and **PDF · Light** / **PDF · Dark** buttons that print the live snapshot with branded print CSS. Fonts are self-hosted; upload the three `templates/fonts/*.woff2` files to R2 as documented in [docs/DEPLOY-PLAN-theme-toggle.md](docs/DEPLOY-PLAN-theme-toggle.md). Local preview: `node scripts/preview.mjs`.

### GDPR: reference contacts

In `cv.json`:

```json
"privacy": {
  "showReferenceContacts": false
}
```

- `false` (default in the sample): show name + role only; hide phone / email / LinkedIn  
- `true`: show full reference contact details  

Quick override without editing JSON (share links):

| URL | Effect |
|-----|--------|
| `/?contacts=0` | Hide reference contacts |
| `/?contacts=1` | Show reference contacts |

### Sample `cv.json`

```json
{
  "name": "Jane Doe",
  "role": "Fullstack Developer · AI & Automation",
  "status": "Available for projects",
  "avatar": "/media/avatar.jpg",
  "privacy": {
    "showReferenceContacts": false
  },
  "contact": {
    "phone": "+00 0 00 00 00 00",
    "email": "you@example.com",
    "website": "https://example.com",
    "location": "City, Region, Country",
    "linkedin": "https://www.linkedin.com/in/example",
    "linkedinLabel": "in/example",
    "github": "https://github.com/example",
    "githubLabel": "github/example"
  },
  "techStack": [
    { "label": "Backend", "items": ["NestJS", "Node.js", "Laravel"] },
    { "label": "Languages", "items": ["TypeScript", "JavaScript", "Python", "SQL"] }
  ],
  "coreSkills": ["Backend & API", "AI & Automation", "Microservices"],
  "education": [
    {
      "title": "Bachelor of Computer Science",
      "detail": "Example University\nCity, Country · 2010–2014"
    }
  ],
  "languages": [
    { "name": "English", "level": "Fluent" }
  ],
  "availability": [
    { "label": "Freelance / B2B", "detail": "remote or hybrid projects" }
  ],
  "summary": "Reliable full-stack developer with a strong backend focus.",
  "experience": [
    {
      "title": "Senior Backend Developer — Example Co",
      "dates": "2023 – Present",
      "location": "Remote",
      "bullets": [
        "Designed and shipped scalable APIs.",
        "Improved reliability with automated tests."
      ]
    }
  ],
  "volunteering": "Contributes to community and open-source initiatives.",
  "references": [
    {
      "name": "Alex Smith",
      "role": "Example Co / Engineering Manager",
      "phone": "+00 0 00 00 00 00",
      "email": "alex@example.com",
      "linkedin": "in/alex-smith"
    }
  ],
  "footer": "Example Development · Reg 00000000 · City, Country"
}
```

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/` | No | Serves HTML from R2 with CV JSON injected as `window.__CV_DATA__` |
| `GET` | `/api/cv` | No | Returns CV JSON from KV |
| `PUT` | `/api/cv` | Bearer | Updates CV JSON in KV |
| `GET` | `/media/:filename` | No | Serves a file from R2 |
| `PUT` | `/media/:filename` | Bearer | Uploads a file to R2 (raw body, or `multipart/form-data` with a `file` part — used by the PocketBase publish flow) |

## Testing (cURL)

Upload template:

```bash
curl -X PUT https://your-worker-url.workers.dev/media/index.html \
  -H "Authorization: Bearer YOUR_SECRET_TOKEN" \
  -H "Content-Type: text/html" \
  --data-binary @index.html
```

Update CV JSON:

```bash
curl -X PUT https://your-worker-url.workers.dev/api/cv \
  -H "Authorization: Bearer YOUR_SECRET_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Your Name", "title": "Full-Stack Developer", "skills": ["Vue.js", "NestJS", "Hono"]}'
```

## License

This project is licensed under the MIT License — see [LICENSE](./LICENSE) for details.

Copyright © 2026 Arthur Rahimov.
