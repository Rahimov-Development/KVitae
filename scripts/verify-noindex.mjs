#!/usr/bin/env node
/**
 * Static checks that cv.rahimov.dev is set up never to be indexed.
 * Does not hit production and does not deploy.
 *
 *   node scripts/verify-noindex.mjs
 *
 * Live header check (after a production deploy, not from this PR):
 *   see docs/noindex-check.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'templates/index.html'), 'utf8');
const src = fs.readFileSync(path.join(root, 'src/index.ts'), 'utf8');

const ROBOTS_META = '<meta name="robots" content="noindex, nofollow">';
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) {
    console.log(`ok    ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name}${detail ? `\n      ${detail}` : ''}`);
  }
}

const head = html.match(/<head>[\s\S]*?<\/head>/i)?.[0] ?? '';
check(
  'templates/index.html has robots meta in <head>',
  head.includes(ROBOTS_META),
  `expected ${ROBOTS_META}`,
);

check(
  'src/index.ts wraps fetch with withRobotsTag',
  /return withRobotsTag\(await app\.fetch\(request, env, ctx\)\)/.test(src) &&
    /headers\.set\(\s*['"]X-Robots-Tag['"]\s*,\s*ROBOTS_TAG\s*\)/.test(src) &&
    /const ROBOTS_TAG = 'noindex, nofollow'/.test(src) &&
    /export default worker/.test(src),
);

check(
  'uncaught errors also get X-Robots-Tag',
  /return withRobotsTag\(\s*new Response\('Internal Server Error', \{ status: 500 \}\)\s*\)/.test(src),
);

check(
  'GET /robots.txt returns Disallow: /',
  /app\.get\(\s*['"]\/robots\.txt['"]/.test(src) &&
    src.includes("c.text('User-agent: *\\nDisallow: /'"),
);

if (failed) {
  console.error(`\n${failed} noindex check(s) failed`);
  process.exit(1);
}

console.log('\nAll noindex checks passed.');
