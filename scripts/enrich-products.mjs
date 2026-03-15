#!/usr/bin/env node
/**
 * enrich-products.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Reads public/data/amazon-products.json, finds any product that is missing
 * title/image/price (or has only an affiliateLink set), fetches the Amazon.in
 * product page server-side, scrapes the details, and writes them back.
 *
 * Usage:
 *   node scripts/enrich-products.mjs
 *
 * Requirements (install once):
 *   npm install --save-dev cheerio node-fetch@3
 *
 * How it works:
 *   • Runs on YOUR machine, not in the browser → no CORS restrictions.
 *   • Extracts the ASIN from the affiliate link and fetches the Amazon page.
 *   • Parses HTML with cheerio to pull title, price, image, description,
 *     rating, and category (from the breadcrumb).
 *   • Skips products that look already complete (have a title and image).
 *   • Writes the enriched JSON back to the same file.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require   = createRequire(import.meta.url);

// Dynamic imports (installed as dev deps)
const { load }  = await import('cheerio');
const { default: fetch } = await import('node-fetch');

// ─── Config ───────────────────────────────────────────────────────────────────

const JSON_PATH = path.resolve(__dirname, '../public/data/amazon-products.json');

/** Mimic a real browser so Amazon doesn't immediately block us */
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/122.0.0.0 Safari/537.36',
  'Accept-Language': 'en-IN,en;q=0.9',
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
};

/** Milliseconds to wait between requests (be polite to Amazon) */
const DELAY_MS = 2500;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Extract the ASIN from common Amazon URL formats */
function asinFromUrl(url) {
  const m =
    url.match(/\/dp\/([A-Z0-9]{10})/) ||
    url.match(/\/gp\/product\/([A-Z0-9]{10})/) ||
    url.match(/\/([A-Z0-9]{10})(?:\/|\?|$)/);
  return m ? m[1] : null;
}

/** Build a clean Amazon.in product URL from an ASIN */
function productUrl(asin) {
  return `https://www.amazon.in/dp/${asin}`;
}

/** Parse star rating like "4.5 out of 5 stars" → 4.5 */
function parseRating(text = '') {
  const m = text.match(/(\d+(?:\.\d+)?)\s+out\s+of\s+5/i);
  return m ? parseFloat(m[1]) : 0;
}

/** Scrape a single Amazon product page and return extracted fields */
async function scrapeAmazon(url) {
  const asin = asinFromUrl(url);
  if (!asin) {
    console.warn(`  ⚠️  Could not extract ASIN from: ${url}`);
    return null;
  }

  const fetchUrl = productUrl(asin);
  console.log(`  ↳ Fetching ${fetchUrl}`);

  let html;
  try {
    const res = await fetch(fetchUrl, { headers: HEADERS, timeout: 15000 });
    if (!res.ok) {
      console.warn(`  ⚠️  HTTP ${res.status} for ${fetchUrl}`);
      return null;
    }
    html = await res.text();
  } catch (err) {
    console.warn(`  ⚠️  Network error: ${err.message}`);
    return null;
  }

  const $ = load(html);

  // If Amazon returned a CAPTCHA / Robot Check page, bail out
  if ($('title').text().toLowerCase().includes('robot check') ||
      $('title').text().toLowerCase().includes('captcha')) {
    console.warn(`  ⚠️  Amazon returned a bot-check page. Try again later or reduce request rate.`);
    return null;
  }

  // ── Title ──────────────────────────────────────────────────────────────────
  const title =
    $('#productTitle').text().trim() ||
    $('h1.a-size-large').first().text().trim() ||
    '';

  // ── Price ──────────────────────────────────────────────────────────────────
  let price = '';
  const wholeEl = $('span.a-price-whole').first();
  const fracEl  = $('span.a-price-fraction').first();
  if (wholeEl.length) {
    const whole = wholeEl.text().replace(/[,\s]/g, '').replace('.', '');
    const frac  = fracEl.text().replace(/[,\s]/g, '') || '00';
    price = `₹${parseInt(whole, 10).toLocaleString('en-IN')}`;
    if (frac && frac !== '00') price += `.${frac}`;
  }
  if (!price) {
    price =
      $('#priceblock_ourprice').text().trim() ||
      $('#priceblock_dealprice').text().trim() ||
      $('.a-offscreen').first().text().trim() ||
      '';
  }

  // ── Image ──────────────────────────────────────────────────────────────────
  let image = '';
  // The main image URL is sometimes encoded in a JSON block inside a <script>
  const imgScript = $('script').toArray().find(
    (el) => $(el).html()?.includes('ImageBlockATF') || $(el).html()?.includes('colorImages')
  );
  if (imgScript) {
    const scriptText = $(imgScript).html() || '';
    // Look for a large JPEG URL
    const imgMatch = scriptText.match(/"large":"(https:\/\/[^"]+\.jpg)"/);
    if (imgMatch) image = imgMatch[1];
  }
  // Fallback: direct img tag
  if (!image) {
    image =
      $('#landingImage').attr('data-old-hires') ||
      $('#landingImage').attr('src') ||
      $('#imgTagWrappingLink img').attr('src') ||
      $('#main-image').attr('src') ||
      '';
  }
  // Strip the URL down to the base (remove size suffix like _SL1500_)
  if (image) {
    image = image.replace(/\._[A-Z0-9_,]+_\./, '._SL400_.');
  }

  // ── Description ────────────────────────────────────────────────────────────
  const bullets = $('#feature-bullets .a-list-item')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter((t) => t.length > 10)
    .slice(0, 2)
    .join(' ');

  const descriptionEl = $('#productDescription p').first().text().trim();
  const description   = bullets || descriptionEl || '';

  // ── Rating ─────────────────────────────────────────────────────────────────
  const ratingText =
    $('#acrPopover').attr('title') ||
    $('span.a-icon-alt').first().text() ||
    '';
  const rating = parseRating(ratingText);

  // ── Category (from breadcrumb) ─────────────────────────────────────────────
  const breadcrumbs = $('#wayfinding-breadcrumbs_feature_div li a')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  // Pick the second breadcrumb (usually main category) or last meaningful one
  const rawCategory = breadcrumbs[1] || breadcrumbs[0] || '';

  return {
    title:       title  || undefined,
    price:       price  || undefined,
    image:       image  || undefined,
    description: description.slice(0, 200) || undefined,
    rating:      rating || undefined,
    rawCategory,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔍 Loading product JSON…');
  const raw  = readFileSync(JSON_PATH, 'utf-8');
  const json = JSON.parse(raw);

  if (!Array.isArray(json.products)) {
    console.error('❌  No "products" array found in the JSON.');
    process.exit(1);
  }

  let updated = 0;

  for (let i = 0; i < json.products.length; i++) {
    const p = json.products[i];

    // Skip if already fully enriched
    const isComplete = p.title && p.image && p.price;
    if (isComplete) {
      console.log(`✅ [${i + 1}/${json.products.length}] Already complete: ${p.title?.slice(0, 50)}`);
      continue;
    }

    if (!p.affiliateLink) {
      console.warn(`⚠️  [${i + 1}/${json.products.length}] No affiliateLink — skipping.`);
      continue;
    }

    console.log(`\n📦 [${i + 1}/${json.products.length}] Enriching product id=${p.id ?? i + 1}`);
    console.log(`   Link: ${p.affiliateLink}`);

    const scraped = await scrapeAmazon(p.affiliateLink);

    if (scraped) {
      if (scraped.title    && !p.title)       p.title       = scraped.title;
      if (scraped.price    && !p.price)       p.price       = scraped.price;
      if (scraped.image    && !p.image)       p.image       = scraped.image;
      if (scraped.description && !p.description) p.description = scraped.description;
      if (scraped.rating   && !p.rating)      p.rating      = scraped.rating;
      // Only set category from breadcrumb if not already set
      if (scraped.rawCategory && !p.category) p.category    = scraped.rawCategory;

      console.log(`   ✅ title: ${p.title?.slice(0, 60)}`);
      console.log(`   ✅ price: ${p.price}  rating: ${p.rating}`);
      updated++;
    } else {
      console.log(`   ❌ Scraping failed — product left as-is.`);
    }

    // Be polite: wait between requests
    if (i < json.products.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  // Write back
  writeFileSync(JSON_PATH, JSON.stringify(json, null, 2) + '\n', 'utf-8');
  console.log(`\n✨ Done! Updated ${updated} product(s). JSON written to:\n   ${JSON_PATH}\n`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
