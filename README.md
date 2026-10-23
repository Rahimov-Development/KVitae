# KVitae — CV Manager (Hono + Cloudflare Workers)

Serverless CV backend on Cloudflare Workers with KV (JSON data) and R2 (HTML/assets).

**Public URL:** [https://cv.rahimov.dev](https://cv.rahimov.dev) — public by design, no Cloudflare Access. Reads (`GET /`, `GET /api/cv`, `GET /media/:filename`) are unauthenticated. Writes (`PUT /api/cv`, `PUT /media/:filename`) still require `Authorization: Bearer AUTH_SECRET` only.

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
| `KVITAE_URL` | `https://cv.rahimov.dev` — CloudOps must switch this **right after** the Worker deploy that attaches the custom domain. The previous `https://cv-manager.arthur-ragimov.workers.dev` URL is disabled (`workers_dev: false`). |
| `KVITAE_AUTH_SECRET` | This Worker's `AUTH_SECRET` |
| `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` | **Not needed** for `cv.rahimov.dev` (no Access app on that hostname). Sending the headers is harmless; remove them from custom-pocketbase config later in a **separate** change. |

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

The current `CLOUDFLARE_API_TOKEN` is **account-level only** (Workers Scripts / KV / R2 Edit, Account Settings Read) and has **no zone permissions**. That is enough to redeploy Worker code, but **not** enough to add or change a Custom Domain.

Attaching `cv.rahimov.dev` via `"custom_domain": true` is a Routes/Custom Domains change. Official Cloudflare docs require zone-scoped permission on **rahimov.dev** in addition to account-level Workers Editor. `wrangler.jsonc` pins `zone_id` `707a2e43b0a76b0724b235419eeb8f6a` (rahimov.dev; not a secret) so Wrangler 4.117 does **not** call `GET /zones` and **Zone Read is not required**.

| Secret | Value |
|--------|--------|
| `CLOUDFLARE_API_TOKEN` | Account: **Workers Scripts Edit** (Editor), **Account Settings Read**, **Workers KV Storage Edit**, **Workers R2 Storage Edit**. Zone (`rahimov.dev` only): **Workers Routes Write** (token UI often labels this **Workers Routes Edit**). No Zone Read. |
| `CLOUDFLARE_ACCOUNT_ID` | `b21935a261bd227400d32c634a32fc20` |

Sources:

- [Workers roles — Routes and Custom Domains](https://developers.cloudflare.com/workers/authorization/workers/#routes-and-custom-domains): add/update/remove Routes or Custom Domains needs `Editor` on the Worker **and** `Zone > Workers Routes > Write` on every affected zone.
- [Roles and permissions](https://developers.cloudflare.com/workers/authorization/): `wrangler deploy` that changes Routes or Custom Domains needs Editor plus Workers Routes Write.
- [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/): Cloudflare creates the DNS record and issues an Advanced Certificate automatically. Official docs do **not** list Zone DNS Edit, Zone Read, or SSL and Certificates as required token permissions for this attach.
- [Wrangler routes](https://developers.cloudflare.com/workers/wrangler/configuration/#types-of-routes): `zone_id` names the zone without a `zone_name` lookup (`zone_name` is the form that needs broader token scope).
- [Edit Cloudflare Workers token template](https://developers.cloudflare.com/fundamentals/api/reference/template/): includes Zone **Workers Routes Write** plus the account Workers/KV/R2 permissions.

Scope the zone permission to **rahimov.dev only**. Do not grant all zones.

The deploy job uses `environment: production`. Create that GitHub Environment (main only, required reviewer) before relying on its protection rules. Environment secrets override repository secrets of the same name; if a name is not set on the environment, the repository secret is still used ([Secrets reference](https://docs.github.com/en/actions/reference/security/secrets)).

Create a token: [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) → **Create Token** → use the **Edit Cloudflare Workers** template, then restrict **Zone Resources** to `rahimov.dev`.

Then set secrets:

```bash
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID --body "b21935a261bd227400d32c634a32fc20"
```

Manual deploy from Actions: **Actions** → **Deploy** → **Run workflow**.

## Authentication

`https://cv.rahimov.dev` is **public by design**. There is no Cloudflare Access application on that hostname. `workers.dev` and preview URLs are disabled in `wrangler.jsonc` (`workers_dev: false`, `preview_urls: false`).

Writes still need the Worker Bearer secret only:

```bash
curl -X PUT https://cv.rahimov.dev/api/cv \
  -H "Authorization: Bearer YOUR_AUTH_SECRET" \
  -H "Content-Type: application/json" \
  --data-binary @cv.json
```

The Worker still contains an optional Access-JWT check (`POLICY_AUD` + `TEAM_DOMAIN`). Those are **not** set in production and must stay unset: with both set, unauthenticated public reads would 403. Do not enable that path for `cv.rahimov.dev`.

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
curl -X PUT https://cv.rahimov.dev/media/index.html \
  -H "Authorization: Bearer YOUR_SECRET_TOKEN" \
  -H "Content-Type: text/html" \
  --data-binary @templates/index.html

curl -X PUT https://cv.rahimov.dev/api/cv \
  -H "Authorization: Bearer YOUR_SECRET_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @cv.json
```

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
curl -X PUT https://cv.rahimov.dev/media/index.html \
  -H "Authorization: Bearer YOUR_SECRET_TOKEN" \
  -H "Content-Type: text/html" \
  --data-binary @index.html
```

Update CV JSON:

```bash
curl -X PUT https://cv.rahimov.dev/api/cv \
  -H "Authorization: Bearer YOUR_SECRET_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Your Name", "title": "Full-Stack Developer", "skills": ["Vue.js", "NestJS", "Hono"]}'
```

## License

This project is licensed under the MIT License — see [LICENSE](./LICENSE) for details.

Copyright © 2026 Arthur Rahimov.
