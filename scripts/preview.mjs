#!/usr/bin/env node
/**
 * Local CV preview. Injects JSON at DATA_INJECTION_POINT and serves
 * self-hosted fonts at the production /media/cv-font-*.woff2 paths.
 *
 *   node scripts/preview.mjs
 *   CV_DATA=./cv.example.json PORT=4173 node scripts/preview.mjs
 *
 * Do not point CV_DATA at unpublished proposal JSON in commits.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4173);
const dataPath = path.resolve(process.env.CV_DATA || path.join(root, 'cv.example.json'));

const FONT_FILES = {
  '/media/cv-font-plus-jakarta-sans.woff2': 'plus-jakarta-sans.woff2',
  '/media/cv-font-inter.woff2': 'inter.woff2',
  '/media/cv-font-jetbrains-mono.woff2': 'jetbrains-mono.woff2',
};

const TYPES = {
  '.woff2': 'font/woff2',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function injectHtml() {
  const html = fs.readFileSync(path.join(root, 'templates/index.html'), 'utf8');
  const data = fs.readFileSync(dataPath, 'utf8');
  JSON.parse(data);
  const script = `<script>window.__CV_DATA__ = ${data};</script>`;
  if (!html.includes('<!-- DATA_INJECTION_POINT -->')) {
    throw new Error('templates/index.html is missing <!-- DATA_INJECTION_POINT -->');
  }
  return html.replace('<!-- DATA_INJECTION_POINT -->', script);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (pathname === '/' || pathname === '/index.html') {
    try {
      const body = injectHtml();
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(String(err));
    }
    return;
  }

  const fontName = FONT_FILES[pathname];
  if (fontName) {
    const file = path.join(root, 'templates/fonts', fontName);
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      res.end('font not found');
      return;
    }
    res.writeHead(200, {
      'content-type': 'font/woff2',
      'cache-control': 'public, max-age=86400',
    });
    fs.createReadStream(file).pipe(res);
    return;
  }

  if (pathname.startsWith('/media/')) {
    const safe = path.basename(pathname);
    const candidates = [
      path.join(root, 'media', safe),
      path.join(root, 'templates', safe),
    ];
    const file = candidates.find((p) => fs.existsSync(p));
    if (!file) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`CV preview http://127.0.0.1:${port}/  (data: ${path.relative(root, dataPath) || dataPath})\n`);
});
