#!/usr/bin/env node
// scripts/scrape-logosystem.js
// Скрапит logosystem.co через Puppeteer — реальный браузер + автоскролл до конца.

const puppeteer = require('puppeteer');
const fs        = require('fs/promises');
const path      = require('path');
const https     = require('https');
const http      = require('http');

const ROOT = path.join(__dirname, '..');

const CATEGORIES = [
  { slug: 'wordmark',        url: 'https://logosystem.co/wordmark',        dir: path.join(ROOT, 'references/wordmark') },
  { slug: 'symbol',          url: 'https://logosystem.co/symbol',          dir: path.join(ROOT, 'references/symbol') },
  { slug: 'symbol-and-text', url: 'https://logosystem.co/symbol-and-text', dir: path.join(ROOT, 'references/symbol-and-text') },
  { slug: 'animated',        url: 'https://logosystem.co/animated',        dir: path.join(ROOT, 'references/animated') },
];

const SCROLL_PAUSE_MS  = 2000;  // пауза после каждого скролла
const DOWNLOAD_DELAY_MS = 400;  // пауза между скачиванием файлов

// ── Скролл до конца страницы ──────────────────────────────────────────────────

async function scrollToBottom(page) {
  let previousCount = 0;

  while (true) {
    // Скроллим до конца
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise(r => setTimeout(r, SCROLL_PAUSE_MS));

    // Считаем framerusercontent src
    const currentCount = await page.evaluate(() =>
      document.querySelectorAll('img[src*="framerusercontent.com"]').length
    );

    console.log(`   Скролл... изображений найдено: ${currentCount}`);

    if (currentCount === previousCount) break; // новых нет — конец
    previousCount = currentCount;
  }
}

// ── Собрать все framerusercontent URL со страницы ─────────────────────────────

async function collectImages(page) {
  return page.evaluate(() => {
    const seen = new Set();

    // img src
    document.querySelectorAll('img').forEach(img => {
      const src = img.src || img.getAttribute('data-src') || '';
      if (src.includes('framerusercontent.com')) seen.add(src.split('?')[0]);
    });

    // CSS background-image в inline style
    document.querySelectorAll('[style]').forEach(el => {
      const m = el.style.backgroundImage.match(/url\(["']?(https:\/\/framerusercontent[^"')?]+)/);
      if (m) seen.add(m[1].split('?')[0]);
    });

    return [...seen];
  });
}

// ── Скачать файл ──────────────────────────────────────────────────────────────

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file  = require('fs').createWriteStream(destPath);
    proto.get(url, { headers: { 'Referer': 'https://logosystem.co/' } }, res => {
      if (res.statusCode !== 200) {
        file.close();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', reject);
  });
}

function guessExt(url) {
  const base = url.split('/').pop().split('?')[0];
  const m    = base.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);
  return m ? `.${m[1].toLowerCase()}` : '.png';
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Обработка одной категории ─────────────────────────────────────────────────

async function processCategory(browser, { slug, url, dir }) {
  console.log(`\n📂 [${slug}]  ${url}`);
  await fs.mkdir(dir, { recursive: true });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

  // Ждём появления первых изображений
  await page.waitForSelector('img', { timeout: 15000 }).catch(() => {});

  // Скроллим до конца
  await scrollToBottom(page);

  // Собираем URL
  const images = await collectImages(page);
  await page.close();

  console.log(`   Итого уникальных изображений: ${images.length}`);

  const downloaded = [];
  const failed     = [];

  for (let i = 0; i < images.length; i++) {
    const imgUrl = images[i];
    const name   = `${slug}-${String(i + 1).padStart(3, '0')}`;
    const ext    = guessExt(imgUrl);
    const dest   = path.join(dir, `${name}${ext}`);

    try {
      await downloadFile(imgUrl, dest);
      downloaded.push(name);
      process.stdout.write(`   ✓ ${name}${ext}  (${i + 1}/${images.length})\r`);
    } catch (err) {
      failed.push(name);
      process.stdout.write(`\n   ✗ ${name}: ${err.message}\n`);
    }

    await sleep(DOWNLOAD_DELAY_MS);
  }

  process.stdout.write('\n');
  return { slug, dir, downloaded: downloaded.length, failed: failed.length };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🖼  logosystem.co scraper (Puppeteer)\n');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const results = [];
  try {
    for (const cat of CATEGORIES) {
      const r = await processCategory(browser, cat);
      results.push(r);
    }
  } finally {
    await browser.close();
  }

  const total = results.reduce((s, r) => s + r.downloaded, 0);

  console.log('\n─────────────────────────────────────────────────────');
  console.log('📊 РЕЗУЛЬТАТ:\n');
  for (const { slug, dir, downloaded, failed } of results) {
    const warn = failed > 0 ? `  ⚠️  ${failed} ошибок` : '';
    console.log(`  ${slug.padEnd(18)} ${downloaded} логотипов${warn}`);
    console.log(`  └─ ${dir}`);
  }
  console.log(`\n  Итого: ${total} логотипов`);
  console.log(`  Папка: ${path.join(ROOT, 'references')}`);
  console.log('─────────────────────────────────────────────────────\n');
}

main().catch(err => {
  console.error('\n❌ Fatal:', err.message);
  process.exit(1);
});
