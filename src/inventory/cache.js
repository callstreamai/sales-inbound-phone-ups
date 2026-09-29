// Per-dealer inventory snapshot. Refreshed in the background; searches never wait on it.
import { captureDealer } from '../adapters/capture.js';
import { captureDirect } from '../adapters/direct.js';
import { allDealers } from '../dealers.js';

const REFRESH_MIN = Number(process.env.INVENTORY_REFRESH_MINUTES || 45);
export function knownSources(dealerId) { return sources.get(dealerId) || null; }
const snapshots = new Map(); // dealer_id -> { vehicles, refreshed_at, diagnostics, error }
const inflight = new Map();
const sources = new Map(); // dealer_id -> { new: [urls], used: [urls] } learned from a Browserless capture

async function capture(dealer) {
  const known = sources.get(dealer.dealer_id) || dealer.direct_sources;
  if (known && known.new && known.used) {
    try { return await captureDirect(dealer, known); }
    catch (err) { console.warn(JSON.stringify({ event: 'inventory_direct_failed', dealer_id: dealer.dealer_id, error: err?.message || String(err) })); }
  }
  const r = await captureDealer(dealer);
  const learned = { new: r.diagnostics.new?.sources || [], used: r.diagnostics.used?.sources || [] };
  if (learned.new.length && learned.used.length && !learned.new.includes('dom') && !learned.used.includes('dom')) sources.set(dealer.dealer_id, learned);
  r.diagnostics.mode = 'browserless';
  return r;
}

export function getSnapshot(dealerId) {
  return snapshots.get(dealerId) || { vehicles: [], refreshed_at: null, diagnostics: null, error: 'not_loaded' };
}

export function loadSeed(dealerId, vehicles) {
  snapshots.set(dealerId, { vehicles, refreshed_at: new Date().toISOString(), diagnostics: { seed: true }, error: null });
}

export async function refreshDealer(dealer) {
  if (inflight.has(dealer.dealer_id)) return inflight.get(dealer.dealer_id);
  const job = (async () => {
    try {
      const { vehicles, diagnostics } = await capture(dealer);
      if (!vehicles.length) {
        const prev = snapshots.get(dealer.dealer_id);
        console.warn(JSON.stringify({ event: 'inventory_refresh_empty', dealer_id: dealer.dealer_id, diagnostics }));
        snapshots.set(dealer.dealer_id, { vehicles: prev?.vehicles || [], refreshed_at: prev?.refreshed_at || null, diagnostics, error: 'empty_capture' });
        return snapshots.get(dealer.dealer_id);
      }
      snapshots.set(dealer.dealer_id, { vehicles, refreshed_at: new Date().toISOString(), diagnostics, error: null });
      console.log(JSON.stringify({ event: 'inventory_refreshed', dealer_id: dealer.dealer_id, count: vehicles.length, elapsed_ms: diagnostics.elapsed_ms }));
      return snapshots.get(dealer.dealer_id);
    } catch (err) {
      const prev = snapshots.get(dealer.dealer_id);
      console.error(JSON.stringify({ event: 'inventory_refresh_failed', dealer_id: dealer.dealer_id, error: err?.message || String(err) }));
      snapshots.set(dealer.dealer_id, { vehicles: prev?.vehicles || [], refreshed_at: prev?.refreshed_at || null, diagnostics: prev?.diagnostics || null, error: err?.message || String(err) });
      return snapshots.get(dealer.dealer_id);
    } finally {
      inflight.delete(dealer.dealer_id);
    }
  })();
  inflight.set(dealer.dealer_id, job);
  return job;
}

export async function refreshAll() {
  for (const d of allDealers()) await refreshDealer(d);
}

export function startScheduler() {
  const anyDirect = allDealers().some((d) => d.direct_sources?.new && d.direct_sources?.used);
  if (!process.env.BROWSERLESS_API_KEY && !anyDirect) {
    console.warn(JSON.stringify({ event: 'inventory_scheduler_disabled', reason: 'BROWSERLESS_API_KEY not set' }));
    return;
  }
  refreshAll().catch(() => {});
  setInterval(() => refreshAll().catch(() => {}), REFRESH_MIN * 60 * 1000).unref();
}

export function cacheSummary() {
  const out = {};
  for (const d of allDealers()) {
    const s = getSnapshot(d.dealer_id);
    out[d.dealer_id] = { count: s.vehicles.length, refreshed_at: s.refreshed_at, error: s.error };
  }
  return out;
}
