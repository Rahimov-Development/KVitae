#!/usr/bin/env node
/**
 * Local verification: both themes render, both A4 PDF variants generate.
 *
 *   npm install --no-save puppeteer-core
 *   node scripts/verify-theme.mjs
 *
 * Optional:
 *   CV_DATA=./cv.example.json
 *   OUT_DIR=./docs/screenshots
 *   PORT=4173
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const port = Number(process.env.PORT || 4173);
const outDir = path.resolve(process.env.OUT_DIR || path.join(root, 'docs/screenshots'));
const chromePath = process.env.CHROME_PATH || '/usr/bin/google-chrome';

function loadPuppeteer() {
  try {
    return require('puppeteer-core');
  } catch {
    console.error('Missing puppeteer-core. Run: npm install --no-save puppeteer-core');
    process.exit(1);
  }
}

function startPreview() {
  const child = spawn(process.execPath, [path.join(root, 'scripts/preview.mjs')], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk) => {
      buf += chunk;
      if (buf.includes('CV preview')) {
        child.stdout.off('data', onData);
        resolve(child);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (c) => process.stderr.write(c));
    child.on('exit', (code) => reject(new Error(`preview exited ${code} before ready\n${buf}`)));
    setTimeout(() => reject(new Error('preview timeout')), 10000);
  });
}

function rgbOf(color) {
  const m = String(color).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function hexClose(rgb, hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return Math.abs(rgb[0] - r) <= 4 && Math.abs(rgb[1] - g) <= 4 && Math.abs(rgb[2] - b) <= 4;
}

async function inspectPdf(file) {
  const info = { path: file, bytes: fs.statSync(file).size, pages: null, fonts: [] };
  const { spawnSync } = await import('node:child_process');
  const pdfinfo = spawnSync('pdfinfo', [file], { encoding: 'utf8' });
  if (pdfinfo.status === 0) {
    const pages = pdfinfo.stdout.match(/Pages:\s+(\d+)/);
    if (pages) info.pages = Number(pages[1]);
  }
  const pdffonts = spawnSync('pdffonts', [file], { encoding: 'utf8' });
  if (pdffonts.status === 0) {
    info.fonts = pdffonts.stdout
      .split('\n')
      .slice(2)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.split(/\s+/)[0]);
    info.embedded = /yes/i.test(pdffonts.stdout);
  }
  return info;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const puppeteer = loadPuppeteer();
  const preview = await startPreview();
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none'],
  });

  const results = { themes: {}, pdfs: {}, screenshots: [] };

  try {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 1800, deviceScaleFactor: 2 });
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
      await page.goto(`http://127.0.0.1:${port}/?theme=${theme}`, { waitUntil: 'networkidle0' });
      await page.evaluateHandle('document.fonts.ready');

      const snapshot = await page.evaluate(() => {
        const root = document.documentElement;
        const body = getComputedStyle(document.body);
        const h1 = getComputedStyle(document.querySelector('h1'));
        const toggle = document.getElementById('themeToggle');
        return {
          dataTheme: root.getAttribute('data-theme'),
          colorScheme: root.style.colorScheme || getComputedStyle(root).colorScheme,
          bodyBg: body.backgroundColor,
          bodyColor: body.color,
          h1Color: h1.color,
          togglePressed: toggle?.getAttribute('aria-pressed'),
          toggleLabel: toggle?.getAttribute('aria-label'),
        };
      });

      const expectedBg = theme === 'dark' ? '#111212' : '#FAF8F3';
      const expectedFg = theme === 'dark' ? '#ECEDE6' : '#1C1A17';
      const bg = rgbOf(snapshot.bodyBg);
      const h1 = rgbOf(snapshot.h1Color);
      if (snapshot.dataTheme !== theme) throw new Error(`${theme}: data-theme=${snapshot.dataTheme}`);
      if (!bg || !hexClose(bg, expectedBg)) throw new Error(`${theme}: body bg ${snapshot.bodyBg} != ${expectedBg}`);
      if (!h1 || !hexClose(h1, expectedFg)) throw new Error(`${theme}: h1 ${snapshot.h1Color} != ${expectedFg}`);
      if (snapshot.togglePressed !== (theme === 'dark' ? 'true' : 'false')) {
        throw new Error(`${theme}: aria-pressed=${snapshot.togglePressed}`);
      }

      const desktop = path.join(outDir, `cv-${theme}-desktop-1280.png`);
      await page.screenshot({ path: desktop, fullPage: true });
      results.screenshots.push(desktop);
      results.themes[theme] = snapshot;

      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
      const mobile = path.join(outDir, `cv-${theme}-mobile-390.png`);
      await page.screenshot({ path: mobile, fullPage: true });
      results.screenshots.push(mobile);

      const pdfPath = path.join(outDir, `cv-${theme}-a4.pdf`);
      await page.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });
      results.pdfs[theme] = await inspectPdf(pdfPath);

      const pdfPage1 = path.join(outDir, `cv-${theme}-a4-1.png`);
      const { spawnSync } = await import('node:child_process');
      const ppm = spawnSync('pdftoppm', ['-png', '-f', '1', '-l', '1', '-r', '144', pdfPath, path.join(outDir, `cv-${theme}-a4`)], { encoding: 'utf8' });
      if (ppm.status !== 0) {
        throw new Error(`pdftoppm ${theme}: ${ppm.stderr || ppm.stdout}`);
      }
      const generated = path.join(outDir, `cv-${theme}-a4-1.png`);
      if (!fs.existsSync(generated)) throw new Error(`missing ${generated}`);
      results.screenshots.push(pdfPage1);
      await page.close();
    }

    // Persistence: set dark, reload without query, expect dark.
    const persistPage = await browser.newPage();
    await persistPage.goto(`http://127.0.0.1:${port}/?theme=light`, { waitUntil: 'networkidle0' });
    await persistPage.click('#themeToggle');
    const stored = await persistPage.evaluate(() => localStorage.getItem('cv-theme'));
    if (stored !== 'dark') throw new Error(`localStorage after toggle: ${stored}`);
    await persistPage.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle0' });
    const restored = await persistPage.evaluate(() => document.documentElement.getAttribute('data-theme'));
    if (restored !== 'dark') throw new Error(`reload theme: ${restored}`);
    await persistPage.close();
    results.persistence = { stored, restored };

    console.log(JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
    preview.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
