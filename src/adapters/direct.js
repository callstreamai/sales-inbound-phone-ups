// Fast path: once a Browserless capture has revealed the JSON endpoint a dealer site uses
// for its search results, later refreshes fetch that endpoint directly. Pagination reuses the
// platform's page parameter. Falls back to Browserless on any failure.
import { extractVehicles } from '../inventory/normalize.js';
import { platformFor } from './platforms.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function getJson(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', Referer: new URL(url).origin + '/' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('json')) throw new Error(`not JSON (${ct})`);
    return await res.json();
  } finally { clearTimeout(t); }
}

export async function captureDirect(dealer, sourcesByCondition) {
  const { pagination, maxPages } = platformFor(dealer);
  const timeoutMs = Number(process.env.DIRECT_TIMEOUT_MS || 12000);
  const started = Date.now();
  const result = { vehicles: [], diagnostics: { mode: 'direct' } };
  for (const condition of ['new', 'used']) {
    const base = (sourcesByCondition[condition] || [])[0];
    if (!base) throw new Error(`no direct source for ${condition}`);
    const all = new Map(); const pages = []; let perPage = 0;
    for (let i = 0; i < maxPages; i++) {
      const url = new URL(base);
      if (i > 0) url.searchParams.set(pagination.param, String(pagination.mode === 'offset' ? pagination.start + i * perPage : pagination.start + i));
      const found = extractVehicles(await getJson(url.toString(), timeoutMs), { condition, baseUrl: dealer.website });
      if (i === 0) { perPage = found.length; if (!perPage) throw new Error(`direct ${condition} page 1 returned no vehicles`); }
      let added = 0;
      for (const v of found) if (!all.has(v.vin)) { all.set(v.vin, v); added++; }
      pages.push({ url: url.toString(), found: found.length, added });
      if (!added) break;
    }
    result.vehicles.push(...all.values());
    result.diagnostics[condition] = { count: all.size, pages, sources: [base] };
  }
  const byVin = new Map();
  for (const v of result.vehicles) if (!byVin.has(v.vin)) byVin.set(v.vin, v);
  result.vehicles = [...byVin.values()];
  result.diagnostics.elapsed_ms = Date.now() - started;
  return result;
}
