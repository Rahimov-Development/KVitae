# Deploy plan: CV light/dark theme toggle

**Do not deploy from this document until Arthur explicitly approves.** This file is deploy-readiness only. This PR does not merge, does not run Wrangler/Cloudflare deploys, and does not touch PocketBase.

## How this repo actually ships

KVitae is a **Cloudflare Worker** (`wrangler.jsonc` name `cv-manager`, entry `src/index.ts`). It is **not** Pages.

| Piece | Where it lives | How it updates |
|---|---|---|
| Worker script (Hono routes) | Cloudflare Workers | GitHub Actions `.github/workflows/deploy.yml` on **push to `main`** (and `workflow_dispatch`) runs `wrangler deploy --minify` |
| HTML shell | R2 bucket `cv-assets`, object `index.html` | `PUT /media/index.html` with Bearer `AUTH_SECRET` |
| CV JSON | KV namespace `CV_STORAGE`, key `cv_data` | `PUT /api/cv` (PocketBase publish, or a manual PUT) |
| Avatar and other binaries | R2 `cv-assets` | `PUT /media/:filename` |
| Self-hosted fonts (this change) | R2 `cv-assets` as **flat** keys (the `:filename` param is a single path segment) | `PUT /media/cv-font-plus-jakarta-sans.woff2` (and Inter, JetBrains Mono) |

`GET /` reads R2 `index.html`, injects `window.__CV_DATA__` from KV, and returns HTML. `wrangler deploy` **does not** upload the template or fonts. Merging this PR and waiting for Actions is **not** enough for visitors to see the theme.

### Hostnames

- Public CV: `https://cv.rahimov.dev`
- Worker name: `cv-manager`. Legacy/alternate hosts: `cv-manager.rahimov.dev` and `*.workers.dev`
- Open PR #2 attaches `cv.rahimov.dev` as a Workers custom domain and sets `workers_dev: false`. Until that is merged and deployed, confirm in the dashboard which hostname currently serves production.

This theme PR does **not** change the Worker, the R2 contract, or CI/deploy workflows. Light and dark PDFs use the existing browser print path (`window.print()` + print CSS), not new R2 PDF objects.

## cv-write (PocketBase publish) — currently blocked

PocketBase (`pb.rahimov.dev`) is the source of truth. Publish is `POST /api/personal/cv/publish` on PocketBase, which then `PUT`s JSON to this Worker’s `/api/cv` and the avatar to `/media/avatar.*`. Helper: `custom-pocketbase/scripts/publish-cv.sh`.

**Reported broken, pending a Cloudflare Access step.** `workers.dev` is behind Access. Browser login does not apply to curl/PocketBase. Writes need a [service token](https://one.dash.cloudflare.com/) (`CF-Access-Client-Id` / `CF-Access-Client-Secret`) on the Access policy, plus `KVITAE_AUTH_SECRET`, as documented in the README.

That block means:

- PocketBase cannot refresh the published KV snapshot or avatar until Access service-token headers work on the URL in `KVITAE_URL`.
- The same Access gate blocks `PUT /media/index.html` and font uploads **if** they are sent to the Access-protected hostname.
- Theme/PDF **code in git** can merge; **going live** still needs a write path: either Access service tokens on `workers.dev`, or PUT to a public hostname (`cv.rahimov.dev`) that is not behind Access, still with Bearer `AUTH_SECRET`.

Do not treat a successful Worker script deploy as “the new CV is live”.

## Pre-checks (before any production write)

1. Arthur’s yes to merge and, separately, to publish R2 objects.
2. Confirm production hostname (`cv.rahimov.dev` vs `cv-manager.rahimov.dev` vs `workers.dev`) and whether Access is on it.
3. Confirm GitHub Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (Worker deploy only).
4. Confirm `AUTH_SECRET` for R2 PUTs. Never commit it or print it.
5. If using `workers.dev`: Access service token is configured and attached to the policy.
6. Local verification already run (see “Test results” in the PR): `npm ci`, `npm run cf-typegen`, `node scripts/verify-theme.mjs`.
7. `npx wrangler deploy --dry-run` (credentials unset is fine) — Worker bundle unchanged in this PR; expect exit 0.
8. Keep PocketBase collections and `cv_data` untouched for this rollout.

## Deploy steps (after merge yes)

Do these in order. Skip Worker deploy if you only need the template (this PR has no `src/` change).

### A. Merge to `main` (Worker)

Only needed if `src/` later changes. This PR’s Worker is unchanged, so Actions deploy is a no-op for visitor-facing HTML.

1. Merge the PR to `main`.
2. Actions → **Deploy** runs `wrangler deploy --minify`.
3. Confirm the workflow is green. Do not run `wrangler deploy` from a laptop unless Arthur asks.

### B. Upload template + fonts (R2) — this is what visitors see

Replace `ORIGIN` with the writable production origin (prefer `https://cv.rahimov.dev` if it is not behind Access).

```bash
ORIGIN='https://cv.rahimov.dev'   # or the Access-gated workers.dev URL
# AUTH_SECRET, and if Access: CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET
# are taken from the environment — do not paste them into shell history docs.

AUTH_HEADER=(-H "Authorization: Bearer ${AUTH_SECRET}")
ACCESS_HEADERS=()
if [ -n "${CF_ACCESS_CLIENT_ID:-}" ]; then
  ACCESS_HEADERS=(
    -H "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}"
    -H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}"
  )
fi

curl -f -X PUT "$ORIGIN/media/index.html" \
  "${AUTH_HEADER[@]}" "${ACCESS_HEADERS[@]}" \
  -H "Content-Type: text/html; charset=utf-8" \
  --data-binary @templates/index.html

curl -f -X PUT "$ORIGIN/media/cv-font-plus-jakarta-sans.woff2" \
  "${AUTH_HEADER[@]}" "${ACCESS_HEADERS[@]}" \
  -H "Content-Type: font/woff2" \
  --data-binary @templates/fonts/plus-jakarta-sans.woff2

curl -f -X PUT "$ORIGIN/media/cv-font-inter.woff2" \
  "${AUTH_HEADER[@]}" "${ACCESS_HEADERS[@]}" \
  -H "Content-Type: font/woff2" \
  --data-binary @templates/fonts/inter.woff2

curl -f -X PUT "$ORIGIN/media/cv-font-jetbrains-mono.woff2" \
  "${AUTH_HEADER[@]}" "${ACCESS_HEADERS[@]}" \
  -H "Content-Type: font/woff2" \
  --data-binary @templates/fonts/jetbrains-mono.woff2
```

Expected: JSON `{ "success": true, "url": "/media/..." }` for each PUT.

The Worker PUT handler stores only `httpMetadata.contentType` (not `Cache-Control` from the request). Font caching is whatever Cloudflare/R2 default is until a later Worker change.

### C. Do not republish CV JSON for this change

Theme CSS does not require a `PUT /api/cv`. PocketBase publish stays blocked on Access; do not attempt it as part of this rollout.

## Post-deploy smoke checks

Run against the **public** origin (`https://cv.rahimov.dev`).

1. **HTML**
   - `GET /` → 200, `content-type: text/html`
   - View-source contains `data-theme` bootstrap script **before** the main CSS, `cv-theme` localStorage key, and **no** `fonts.googleapis.com`
   - `GET /` body includes `<!-- DATA_INJECTION_POINT -->` **replaced** by `window.__CV_DATA__` (not the comment)
2. **Fonts**
   - `GET /media/cv-font-plus-jakarta-sans.woff2` (and inter, jetbrains-mono) → 200, `content-type: font/woff2` (or the type stored at PUT)
   - Network tab: three font requests, no Google Fonts
3. **Themes**
   - First visit, OS light → page is light (`data-theme="light"`, page background `#FAF8F3`)
   - First visit, OS dark (or DevTools `prefers-color-scheme: dark`) with empty localStorage → dark (`#111212`)
   - Toggle **Dark theme** / **Light theme**: `aria-pressed` flips, keyboard (`Tab`, `Enter`/`Space`) works
   - Reload: saved choice wins over OS preference (Application → Local Storage → `cv-theme`)
   - Hard-reload with cache disabled: no flash of the wrong theme
4. **PDFs (browser print, not R2 objects)**
   - **PDF · Light** opens the print dialog; destination “Save as PDF”; backgrounds optional for light (white sheet)
   - **PDF · Dark** keeps dark surfaces (`print-color-adjust: exact`). In Chrome, enable **Background graphics**
   - After cancel/save, screen theme returns to the saved toggle (not stuck on the print theme)
   - `?theme=dark` / `?theme=light` forces a one-off paint for headless print; it does not write localStorage
5. **Cache headers**
   - `GET /` and `GET /api/cv`: note `cache-control` / `cf-cache-status`. Today the Worker does not set `Cache-Control`; a stale HTML body after R2 PUT means wait for CF cache or purge `cv.rahimov.dev/`
   - `GET /media/index.html` is the raw R2 object (no JSON injection). Visitors use `GET /`
   - Font `GET /media/cv-font-*`: note `etag`, `cf-cache-status`. If `HIT` with the old object after overwrite, purge those three URLs
6. **Auth unchanged**
   - `PUT /api/cv` and `PUT /media/:f` without Bearer → 401/403
   - No new routes

## Rollback

Nothing in KV needs reverting for this change.

### 1. Restore previous `index.html` (visitor-facing)

Keep a copy of the current R2 object **before** step B:

```bash
curl -fsS "$ORIGIN/media/index.html" -o /tmp/index.html.prev
```

Restore:

```bash
curl -f -X PUT "$ORIGIN/media/index.html" \
  "${AUTH_HEADER[@]}" "${ACCESS_HEADERS[@]}" \
  -H "Content-Type: text/html; charset=utf-8" \
  --data-binary @/tmp/index.html.prev
```

If the previous object was not saved, check out the last `main` commit that contained `templates/index.html` and PUT that file instead:

```bash
git show main:templates/index.html > /tmp/index.html.main
# then PUT as above
```

### 2. Font objects

The old template does not request `cv-font-*.woff2`. Leaving them in R2 is harmless. To delete, there is **no DELETE route** on the Worker today — remove objects in the Cloudflare dashboard (R2 → `cv-assets`) or leave them.

### 3. Worker script

This PR does not change `src/index.ts`. If a later Worker deploy is the problem, Actions → the last green **Deploy** on `main` before the bad commit, or:

```bash
git checkout <good-sha>
# Arthur runs: npx wrangler deploy --minify
```

There are **no previous PDF objects** to restore: PDFs are not stored in R2. Visitors generate them in the browser from the live HTML.

### 4. Cache after rollback

Purge `https://cv.rahimov.dev/` (and `/media/index.html` if it was cached) so the restored HTML is not a HIT of the themed template.

## What remains after this PR (needs human / Access / dashboard)

- Cloudflare Access service token so **cv-write** (PocketBase → `PUT /api/cv` and avatar) works again
- Actual R2 PUTs of `index.html` + three fonts (blocked on the same write path if targeting Access-gated `workers.dev`)
- Optional: Worker `Cache-Control` on `/media` (PUT currently stores content type only)
- Optional: merge/deploy PR #2 (custom domain / `workers_dev: false`) — separate from theme
- No PocketBase schema or `cv_data` change for theme
