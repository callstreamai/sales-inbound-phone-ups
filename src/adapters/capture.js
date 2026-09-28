// Browserless capture engine. Loads a dealer's search results pages in a real browser,
// listens to the JSON the page itself fetches, and extracts vehicles from it. This runs
// only in the background cache refresh, never while a caller is waiting.
import { chromium } from 'playwright-core';
import { extractVehicles } from '../inventory/normalize.js';
import { platformFor, pageUrl } from './platforms.js';

const VIN_SCAN = /[A-HJ-NPR-Z0-9]{17}/;
const NAV_TIMEOUT_MS = Number(process.env.CAPTURE_NAV_TIMEOUT_MS || 30000);
const SETTLE_MS = Number(process.env.CAPTURE_SETTLE_MS || 2500);

function wsEndpoint() {
  const token = process.env.BROWSERLESS_API_KEY;
  if (!token) throw new Error('BROWSERLESS_API_KEY is not configured');
  const region = process.env.BROWSERLESS_REGION || 'production-sfo.browserless.io';
  const timeout = Number(process.env.BROWSERLESS_TIMEOUT_MS || 5 * 60 * 1000);
  return `wss://${region}/chromium?token=${encodeURIComponent(token)}&timeout=${timeout}&blockAds=true`;
}

// Last-resort DOM scrape for sites whose data never passes through a JSON response.
async function domVehicles(page) {
  return page.evaluate(() => {
    const out = [];
    document.querySelectorAll('[data-vin]').forEach((el) => {
      const d = el.dataset || {};
      const o = {};
      for (const k of Object.keys(d)) o[k] = d[k];
      const link = el.querySelector('a[href]');
      if (link && !o.url) o.url = link.getAttribute('href');
      out.push(o);
    });
    document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      try { out.push(JSON.parse(s.textContent)); } catch { /* ignore */ }
    });
    return out;
  });
}

async function capturePage(page, url, condition, baseUrl, sources) {
  const payloads = [];
  const onResponse = async (res) => {
    try {
      const ct = (res.headers()['content-type'] || '').toLowerCase();
      if (!ct.includes('json')) return;
      const text = await res.text();
      if (!VIN_SCAN.test(text)) return;
      payloads.push({ url: res.url(), json: JSON.parse(text) });
    } catch { /* body unavailable or not JSON; ignore */ }
  };
  page.on('response', onResponse);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    await page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT_MS }).catch(() => {});
    await page.waitForTimeout(SETTLE_MS);
  } finally {
    page.off('response', onResponse);
  }
  const vehicles = new Map();
  for (const p of payloads) {
    const found = extractVehicles(p.json, { condition, baseUrl });
    if (found.length) sources.add(p.url.split('?')[0]);
    for (const v of found) if (!vehicles.has(v.vin)) vehicles.set(v.vin, v);
  }
  if (!vehicles.size) {
    for (const v of extractVehicles(await domVehicles(page), { condition, baseUrl })) if (!vehicles.has(v.vin)) vehicles.set(v.vin, v);
    if (vehicles.size) sources.add('dom');
  }
  return [...vehicles.values()];
}

// Capture all inventory for one condition ("new" or "used"), following pagination until a
// page adds nothing new.
export async function captureCondition(browser, dealer, condition) {
  const { maxPages } = platformFor(dealer);
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' });
  await context.route('**/*', (route) => {
    const t = route.request().resourceType();
    return ['image', 'media', 'font'].includes(t) ? route.abort() : route.continue();
  });
  const page = await context.newPage();
  const all = new Map();
  const sources = new Set();
  const pages = [];
  let perPage = 0;
  try {
    for (let i = 0; i < maxPages; i++) {
      const url = pageUrl(dealer, condition, i, perPage || 1);
      const found = await capturePage(page, url, condition, dealer.website, sources);
      if (i === 0) perPage = found.length;
      let added = 0;
      for (const v of found) if (!all.has(v.vin)) { all.set(v.vin, v); added++; }
      pages.push({ url, found: found.length, added });
      if (!added || !perPage) break;
    }
  } finally {
    await context.close().catch(() => {});
  }
  return { vehicles: [...all.values()], pages, sources: [...sources] };
}

export async function captureDealer(dealer) {
  const started = Date.now();
  const browser = await chromium.connectOverCDP(wsEndpoint(), { timeout: NAV_TIMEOUT_MS });
  try {
    const result = { vehicles: [], diagnostics: {} };
    for (const condition of ['new', 'used']) {
      const r = await captureCondition(browser, dealer, condition);
      result.vehicles.push(...r.vehicles);
      result.diagnostics[condition] = { count: r.vehicles.length, pages: r.pages, sources: r.sources };
    }
    // A VIN seen on both pages keeps its first entry.
    const byVin = new Map();
    for (const v of result.vehicles) if (!byVin.has(v.vin)) byVin.set(v.vin, v);
    result.vehicles = [...byVin.values()];
    result.diagnostics.elapsed_ms = Date.now() - started;
    return result;
  } finally {
    await browser.close().catch(() => {});
  }
}
