# Manual noindex check (`cv.rahimov.dev`)

The Worker must never be indexed. `X-Robots-Tag: noindex, nofollow` is set in a
single fetch wrapper in `src/index.ts` (every response: HTML, JSON, `/media/*`,
`/robots.txt`, 404s, auth errors). The HTML shell also has a robots meta tag.

There is no unit-test runner in this repo. Static checks:

```bash
npm run verify:noindex
```

## After a production deploy (do not deploy from the noindex PR)

`wrangler deploy` does **not** upload `templates/index.html`. After merging, also
`PUT` that file to R2 key `index.html` (`PUT /media/index.html`) so the live
`<head>` includes the meta tag. Compute the SHA-256 first:

```bash
sha256sum templates/index.html
```

Replace `BASE` with the live hostname (`https://cv.rahimov.dev`). If Access is
on that host, add service-token headers. Never print secrets.

```bash
BASE=https://cv.rahimov.dev

for path in / /api/cv /robots.txt /media/index.html /does-not-exist; do
  echo "=== GET $path ==="
  curl -sS -D - -o /dev/null "$BASE$path" | grep -i -E 'HTTP/|x-robots-tag|content-type'
  echo
done

echo "=== robots.txt body ==="
curl -sS "$BASE/robots.txt"
echo
```

Expect:

| Check | Expected |
|-------|----------|
| Every path above | `X-Robots-Tag: noindex, nofollow` |
| `GET /robots.txt` | `200`, `Content-Type: text/plain` (charset optional), body `User-agent: *` then `Disallow: /` |
| `GET /` HTML | `<meta name="robots" content="noindex, nofollow">` in `<head>` |
| `GET /does-not-exist` | 404 **and** the same `X-Robots-Tag` |

`GET /` and `GET /api/cv` without a valid Access JWT may be `403` on
Access-gated hostnames. The robots header must still be present on that 403.

To confirm the HTML meta after the R2 upload:

```bash
curl -sS "$BASE/" | grep -F '<meta name="robots" content="noindex, nofollow">'
```
