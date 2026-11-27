import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import type { Context, Next } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';

type Bindings = {
  CV_STORAGE: KVNamespace;
  CV_BUCKET: R2Bucket;
  AUTH_SECRET: string;
  /** Cloudflare Access application audience (AUD) tag */
  POLICY_AUD?: string;
  /** e.g. https://your-team.cloudflareaccess.com */
  TEAM_DOMAIN?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksTeamDomain: string | null = null;

function getJwks(teamDomain: string) {
  if (!jwks || jwksTeamDomain !== teamDomain) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    jwksTeamDomain = teamDomain;
  }
  return jwks;
}

/**
 * When POLICY_AUD + TEAM_DOMAIN are set, require a valid Cloudflare Access JWT.
 * Edge Access should already gate traffic; this is defense in depth.
 */
const withAccessJwt = async (c: Context<{ Bindings: Bindings }>, next: Next) => {
  const audience = c.env.POLICY_AUD;
  const teamDomain = c.env.TEAM_DOMAIN?.replace(/\/$/, '');

  if (!audience || !teamDomain) {
    return next();
  }

  const token = c.req.header('cf-access-jwt-assertion');
  if (!token) {
    return c.text('Missing Cloudflare Access JWT', 403);
  }

  try {
    await jwtVerify(token, getJwks(teamDomain), {
      issuer: teamDomain,
      audience,
    });
    return next();
  } catch {
    return c.text('Invalid Cloudflare Access JWT', 403);
  }
};

app.use('*', withAccessJwt);

const withAuth = async (c: Context<{ Bindings: Bindings }>, next: Next) => {
  const auth = bearerAuth({ token: c.env.AUTH_SECRET });
  return auth(c, next);
};

const ROBOTS_TAG = 'noindex, nofollow';

/** Clone a Response and set X-Robots-Tag so crawlers never index this host. */
function withRobotsTag(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', ROBOTS_TAG);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

app.get('/robots.txt', (c) => c.text('User-agent: *\nDisallow: /', 200, { 'Content-Type': 'text/plain' }));

app.get('/', async (c) => {
  let htmlStr = '';

  const templateObj = await c.env.CV_BUCKET.get('index.html');

  if (templateObj) {
    htmlStr = await templateObj.text();
  } else {
    htmlStr = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta name="robots" content="noindex, nofollow">
          <title>My CV</title>
      </head>
      <body>
          <h1>Resume Server Running</h1>
          <p>Please upload an index.html to your R2 bucket.</p>
          <!-- DATA_INJECTION_POINT -->
      </body>
      </html>
    `;
  }

  const cvData = (await c.env.CV_STORAGE.get('cv_data')) || '{}';
  const injectionScript = `<script>window.__CV_DATA__ = ${cvData};</script>`;
  const finalHtml = htmlStr.includes('<!-- DATA_INJECTION_POINT -->')
    ? htmlStr.replace('<!-- DATA_INJECTION_POINT -->', injectionScript)
    : htmlStr.replace('</body>', `${injectionScript}</body>`);

  return c.html(finalHtml);
});

app.get('/api/cv', async (c) => {
  const data = await c.env.CV_STORAGE.get('cv_data', 'json');
  return c.json(data || {});
});

app.get('/media/:filename', async (c) => {
  const filename = c.req.param('filename');
  const object = await c.env.CV_BUCKET.get(filename);

  if (!object) {
    return c.notFound();
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);

  return new Response(object.body as ReadableStream, { headers });
});

app.put('/api/cv', withAuth, async (c) => {
  try {
    const body = await c.req.json();
    await c.env.CV_STORAGE.put('cv_data', JSON.stringify(body));
    return c.json({ success: true, message: 'CV updated successfully' });
  } catch {
    return c.json({ success: false, error: 'Invalid JSON payload' }, 400);
  }
});

const MEDIA_EXTENSION_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  html: 'text/html; charset=utf-8',
  css: 'text/css',
  js: 'text/javascript',
  json: 'application/json',
  pdf: 'application/pdf',
};

function contentTypeFromExtension(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return MEDIA_EXTENSION_TYPES[ext] ?? 'application/octet-stream';
}

app.put('/media/:filename', withAuth, async (c) => {
  const filename = c.req.param('filename');

  let body: ReadableStream | null;
  let contentType = c.req.header('content-type') || 'application/octet-stream';

  if (contentType.startsWith('multipart/form-data')) {
    // PocketBase JSVM can only send binaries as multipart FormData;
    // accept a "file" part (or the first file part) as the object body.
    const form = await c.req.raw.formData();
    const candidate = form.get('file') ?? [...form.values()].find((v) => v instanceof File);
    if (!(candidate instanceof File)) {
      return c.json({ success: false, error: 'Multipart body must include a file part' }, 400);
    }
    body = candidate.stream();
    // Multipart parts often arrive without a useful type; fall back to the extension.
    contentType =
      candidate.type && candidate.type !== 'application/octet-stream'
        ? candidate.type
        : contentTypeFromExtension(filename);
  } else {
    body = c.req.raw.body;
  }

  if (!body) {
    return c.json({ success: false, error: 'Empty body' }, 400);
  }

  await c.env.CV_BUCKET.put(filename, body, {
    httpMetadata: { contentType },
  });

  return c.json({
    success: true,
    message: `File ${filename} uploaded successfully`,
    url: `/media/${filename}`,
  });
});

/**
 * Central fetch wrapper: every response (HTML, JSON, media, robots.txt, 404s,
 * auth errors, and uncaught exceptions) gets X-Robots-Tag. Do not add routes
 * that bypass this export.
 */
const worker = {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    try {
      return withRobotsTag(await app.fetch(request, env, ctx));
    } catch {
      return withRobotsTag(new Response('Internal Server Error', { status: 500 }));
    }
  },
};

export default worker;
