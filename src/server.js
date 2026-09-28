import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { z } from 'zod';
import { findDealer, allDealers, salesStatus } from './dealers.js';
import { getSnapshot, refreshDealer, refreshAll, startScheduler, cacheSummary, loadSeed } from './inventory/cache.js';
import { searchVehicles, facets } from './inventory/search.js';
import { spokenVehicle, spokenResults, spokenPrice } from './inventory/spoken.js';
import { vinStillListed } from './inventory/liveCheck.js';
import { buildAdf } from './lead/adf.js';
import { sendAdfEmail } from './lead/resend.js';

const PORT = process.env.PORT || 10000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const LEAD_MODE = (process.env.LEAD_MODE || 'safe').toLowerCase(); // safe | live
const SAFE_LEAD_EMAIL = process.env.SAFE_LEAD_EMAIL || '';
const LEAD_ARCHIVE_BCC = process.env.LEAD_ARCHIVE_BCC || '';
const SERVICE = 'sales-inbound-phone-ups';

const app = express();
app.use(helmet());
app.use(express.json({ limit: '256kb' }));
app.use(morgan('tiny'));

function requireAuth(req, res, next) {
  if (!WEBHOOK_SECRET) return next();
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : req.headers['x-webhook-secret'];
  if (token === WEBHOOK_SECRET) return next();
  return res.status(401).json({ success: false, status: 'unauthorized' });
}

// Bland sends null, "null", "none", or "Unknown" for anything the caller didn't give.
const EMPTY = /^(null|undefined|none|unknown|n\/a|na|no|not provided|)$/i;
const clean = (v) => (v == null ? '' : EMPTY.test(String(v).trim()) ? '' : String(v).trim());
const optStr = z.any().transform(clean);
const optNum = z.any().transform((v) => { const s = clean(v).replace(/[^0-9.]/g, ''); return s ? Number(s) : null; });
const optBool = z.any().transform((v) => (typeof v === 'boolean' ? v : /^(true|yes|y|1)$/i.test(clean(v))));

const DealerRef = { dealer_id: optStr, to: optStr, call_id: optStr };
const SearchSchema = z.object({
  ...DealerRef,
  condition: optStr, year: optNum, make: optStr, model: optStr, trim: optStr, fuel_type: optStr,
  body_style: optStr, color: optStr, max_price: optNum, max_mileage: optNum, stock: optStr, vin: optStr,
});
const VehicleSchema = z.object({ ...DealerRef, stock: optStr, vin: optStr });
const LeadSchema = z.object({
  ...DealerRef,
  customer_name: optStr, customer_phone: optStr, customer_email: optStr, from: optStr,
  vehicle_vin: optStr, vehicle_stock: optStr, vehicle_year: optNum, vehicle_make: optStr, vehicle_model: optStr,
  vehicle_trim: optStr, vehicle_condition: optStr, vehicle_color: optStr, vehicle_price: optNum,
  vehicle_interest_text: optStr,
  has_trade: optBool, trade_year: optNum, trade_make: optStr, trade_model: optStr, trade_description: optStr,
  timeframe: optStr, comments: optStr, consent_recorded: optBool,
});

function resolveDealer(req, res) {
  const d = findDealer({ dealer_id: clean(req.body?.dealer_id || req.query?.dealer_id), to: clean(req.body?.to || req.query?.to) });
  if (!d) { res.status(404).json({ success: false, status: 'dealer_not_found', message: 'No dealer matches dealer_id or the dialed number.' }); return null; }
  return d;
}

const flatVehicle = (v, prefix) => (v ? {
  [`${prefix}_vin`]: v.vin, [`${prefix}_stock`]: v.stock, [`${prefix}_year`]: String(v.year), [`${prefix}_make`]: v.make,
  [`${prefix}_model`]: v.model, [`${prefix}_trim`]: v.trim, [`${prefix}_condition`]: v.condition, [`${prefix}_color`]: v.exterior_color,
  [`${prefix}_mileage`]: v.mileage != null ? String(v.mileage) : '', [`${prefix}_price`]: v.price ? String(v.price) : '',
  [`${prefix}_price_spoken`]: v.price ? spokenPrice(v.price) : '', [`${prefix}_price_type`]: v.price_type || '',
  [`${prefix}_in_transit`]: String(Boolean(v.in_transit)), [`${prefix}_url`]: v.url, [`${prefix}_spoken`]: spokenVehicle(v),
} : {});

app.get('/', (_req, res) => res.json({ service: SERVICE, ok: true }));
app.get('/health', (_req, res) => res.json({
  ok: true, service: SERVICE, lead_mode: LEAD_MODE, resendConfigured: Boolean(process.env.RESEND_API_KEY && process.env.LEAD_FROM_EMAIL),
  browserlessConfigured: Boolean(process.env.BROWSERLESS_API_KEY), dealers: allDealers().map((d) => d.dealer_id), inventory: cacheSummary(),
}));

// Called at the top of the call: who is this dealer, is sales open, is inventory loaded.
app.post('/call/start', requireAuth, (req, res) => {
  const dealer = resolveDealer(req, res); if (!dealer) return;
  const snap = getSnapshot(dealer.dealer_id);
  const counts = { new: 0, used: 0 };
  for (const v of snap.vehicles) counts[v.condition === 'new' ? 'new' : 'used']++;
  res.json({
    success: true, dealer_id: dealer.dealer_id, dealer_name: dealer.name, brand: dealer.brand || '', dealer_address: dealer.address || '',
    sales_transfer_number: dealer.sales_transfer_number || dealer.sales_phone || '', service_phone: dealer.service_phone || '', parts_phone: dealer.parts_phone || '',
    ...salesStatus(dealer), inventory_ready: snap.vehicles.length > 0, new_count: counts.new, used_count: counts.used, inventory_as_of: snap.refreshed_at || '',
  });
});

app.post('/inventory/search', requireAuth, (req, res) => {
  const dealer = resolveDealer(req, res); if (!dealer) return;
  const q = SearchSchema.parse(req.body || {});
  const snap = getSnapshot(dealer.dealer_id);
  if (!snap.vehicles.length) {
    return res.json({ success: false, found: false, status: 'inventory_unavailable', match_count: 0, results_spoken: '', message: 'Inventory has not loaded for this dealer.' });
  }
  const { matches, relaxed } = searchVehicles(snap.vehicles, q);
  const top = matches.slice(0, 3);
  const modelPool = q.model ? searchVehicles(snap.vehicles, { condition: q.condition, make: q.make, model: q.model }).matches : matches;
  const f = facets(modelPool);
  const payload = {
    success: true, found: matches.length > 0, status: matches.length ? (relaxed ? 'partial_match' : 'match') : 'no_match', match_count: matches.length,
    model_total: modelPool.length, results_spoken: spokenResults(top, matches.length, q),
    no_match_spoken: matches.length ? '' : (modelPool.length ? `I don't see one matching everything you asked for, but I do have ${modelPool.length} ${[q.year, q.make, q.model].filter(Boolean).join(' ')} in stock.` : `I'm not seeing that in stock right now.`),
    relaxed_note: relaxed ? 'Closest matches shown; some preferences (trim, color, or budget) were not met exactly.' : '',
    available_trims: f.trims.join(', '), available_colors: f.colors.join(', '), available_years: f.years.join(', '),
    price_low_spoken: f.price_low ? spokenPrice(f.price_low) : '', price_high_spoken: f.price_high ? spokenPrice(f.price_high) : '',
    inventory_as_of: snap.refreshed_at, ...flatVehicle(top[0], 'vehicle'), ...flatVehicle(top[0], 'vehicle_1'), ...flatVehicle(top[1], 'vehicle_2'), ...flatVehicle(top[2], 'vehicle_3'),
  };
  console.log(JSON.stringify({ event: 'inventory_search', dealer_id: dealer.dealer_id, call_id: q.call_id || null, q: { condition: q.condition, year: q.year, make: q.make, model: q.model, trim: q.trim }, matches: matches.length, status: payload.status }));
  res.json(payload);
});

// One specific unit, checked live against the dealer site.
app.post('/inventory/vehicle', requireAuth, async (req, res) => {
  const dealer = resolveDealer(req, res); if (!dealer) return;
  const q = VehicleSchema.parse(req.body || {});
  const snap = getSnapshot(dealer.dealer_id);
  const v = snap.vehicles.find((x) => (q.vin && x.vin === q.vin.toUpperCase()) || (q.stock && x.stock.toLowerCase() === q.stock.toLowerCase()));
  if (!v) return res.json({ success: true, found: false, status: 'not_in_cache', still_listed: 'unknown' });
  const live = await vinStillListed(dealer, v.vin);
  res.json({ success: true, found: true, status: live.checked ? (live.listed ? 'listed' : 'not_listed') : 'cache_only', still_listed: live.checked ? String(live.listed) : 'unknown', ...flatVehicle(v, 'vehicle') });
});

const sentLeads = new Map(); // call_id -> response (idempotency for webhook retries)

app.post('/lead/submit', requireAuth, async (req, res) => {
  const dealer = resolveDealer(req, res); if (!dealer) return;
  const b = LeadSchema.parse(req.body || {});
  if (b.call_id && sentLeads.has(b.call_id)) return res.json({ ...sentLeads.get(b.call_id), duplicate: true });
  const phone = b.customer_phone || b.from;
  const status = salesStatus(dealer);
  // Prefer the cached record for the chosen unit so the ADF carries the exact VIN/stock/price.
  const snap = getSnapshot(dealer.dealer_id);
  const cached = snap.vehicles.find((x) => (b.vehicle_vin && x.vin === b.vehicle_vin.toUpperCase()) || (b.vehicle_stock && x.stock && x.stock.toLowerCase() === b.vehicle_stock.toLowerCase()));
  const vehicle = cached || (b.vehicle_model ? { vin: b.vehicle_vin, stock: b.vehicle_stock, year: b.vehicle_year, make: b.vehicle_make || dealer.brand, model: b.vehicle_model, trim: b.vehicle_trim, condition: /new/i.test(b.vehicle_condition) ? 'new' : b.vehicle_condition ? 'used' : '', exterior_color: b.vehicle_color, price: b.vehicle_price, price_type: 'listed' } : null);
  const commentParts = [b.comments, b.vehicle_interest_text && !cached ? `Vehicle of interest (caller's words): ${b.vehicle_interest_text}` : '', b.consent_recorded ? 'Caller consented to call recording.' : ''].filter(Boolean).join('\n');
  const xml = buildAdf({ dealer, customer: { name: b.customer_name, phone, email: b.customer_email }, vehicle, comments: commentParts, trade: { has_trade: b.has_trade, year: b.trade_year, make: b.trade_make, model: b.trade_model, description: b.trade_description }, timeframe: b.timeframe, call_id: b.call_id });

  const vehicleLabel = vehicle ? [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(' ') : 'general sales inquiry';
  const summaryBase = `Caller ${b.customer_name || 'unknown name'}, phone ${phone || 'unknown'}${b.customer_email ? ', email ' + b.customer_email : ''}. Interested in ${vehicleLabel}${vehicle?.stock ? ', stock ' + vehicle.stock : ''}${vehicle?.condition ? ' (' + vehicle.condition + ')' : ''}. ${b.has_trade ? 'Has a trade-in' + ([b.trade_year, b.trade_make, b.trade_model].filter(Boolean).length ? ': ' + [b.trade_year, b.trade_make, b.trade_model].filter(Boolean).join(' ') : '') + '.' : 'No trade-in.'}${b.timeframe ? ' Timeframe: ' + b.timeframe + '.' : ''}`;

  let to = dealer.adf_email;
  let mode = 'live';
  if (LEAD_MODE !== 'live') { to = SAFE_LEAD_EMAIL; mode = 'safe'; }
  let result;
  if (!to) {
    result = { ok: false, status: mode === 'safe' ? 'safe_mode_no_test_inbox' : 'dealer_adf_email_missing', error: mode === 'safe' ? 'SAFE_LEAD_EMAIL is not set' : `No adf_email configured for ${dealer.dealer_id}` };
  } else {
    result = await sendAdfEmail({ to, subject: `ADF Lead: ${vehicleLabel} - ${b.customer_name || 'Phone up'}${mode === 'safe' ? ' [TEST]' : ''}`, text: xml, bcc: LEAD_ARCHIVE_BCC || undefined, tags: [{ name: 'dealer', value: dealer.dealer_id.replace(/[^a-z0-9_-]/gi, '_') }, { name: 'mode', value: mode }] });
  }
  const response = {
    success: result.ok, lead_sent: result.ok, status: result.ok ? (mode === 'safe' ? 'sent_test_inbox' : 'sent') : result.status, lead_mode: mode, lead_id: result.id || '',
    message: result.ok ? 'Lead delivered to the dealer CRM.' : (result.error || 'Lead was not sent.'),
    transfer_summary: `${summaryBase} ${result.ok ? 'An ADF lead has been sent to the CRM.' : 'NO lead was created in the CRM; please capture the details manually.'}`,
    ...status, sales_transfer_number: dealer.sales_transfer_number || dealer.sales_phone || '', vehicle_label: vehicleLabel,
  };
  console.log(JSON.stringify({ event: 'lead_submit', dealer_id: dealer.dealer_id, call_id: b.call_id || null, mode, ok: result.ok, status: response.status, resend_id: result.id || null, error: result.error || null }));
  if (b.call_id && result.ok) sentLeads.set(b.call_id, response);
  res.json(response);
});

// Operator endpoints.
app.post('/adf/preview', requireAuth, (req, res) => {
  const dealer = resolveDealer(req, res); if (!dealer) return;
  const b = LeadSchema.parse(req.body || {});
  const xml = buildAdf({ dealer, customer: { name: b.customer_name, phone: b.customer_phone || b.from, email: b.customer_email }, vehicle: b.vehicle_model ? { vin: b.vehicle_vin, stock: b.vehicle_stock, year: b.vehicle_year, make: b.vehicle_make || dealer.brand, model: b.vehicle_model, trim: b.vehicle_trim, condition: b.vehicle_condition, exterior_color: b.vehicle_color, price: b.vehicle_price, price_type: 'listed' } : null, comments: b.comments, trade: { has_trade: b.has_trade, year: b.trade_year, make: b.trade_make, model: b.trade_model, description: b.trade_description }, timeframe: b.timeframe, call_id: b.call_id });
  res.type('application/xml').send(xml);
});
app.get('/inventory/status', requireAuth, (_req, res) => {
  const out = {};
  for (const d of allDealers()) { const s = getSnapshot(d.dealer_id); out[d.dealer_id] = { count: s.vehicles.length, refreshed_at: s.refreshed_at, error: s.error, diagnostics: s.diagnostics }; }
  res.json(out);
});
app.post('/inventory/refresh', requireAuth, async (req, res) => {
  const dealer = clean(req.body?.dealer_id || req.query?.dealer_id) ? resolveDealer(req, res) : null;
  if (clean(req.body?.dealer_id || req.query?.dealer_id) && !dealer) return;
  if (req.query?.wait === '1') {
    const snap = dealer ? await refreshDealer(dealer) : (await refreshAll(), null);
    return res.json({ ok: true, waited: true, inventory: cacheSummary(), diagnostics: snap?.diagnostics || null, error: snap?.error || null });
  }
  (dealer ? refreshDealer(dealer) : refreshAll()).catch(() => {});
  res.json({ ok: true, started: true });
});
app.get('/inventory/sample', requireAuth, (req, res) => {
  const dealer = resolveDealer(req, res); if (!dealer) return;
  const snap = getSnapshot(dealer.dealer_id);
  res.json({ count: snap.vehicles.length, refreshed_at: snap.refreshed_at, sample: snap.vehicles.slice(0, Number(req.query.n || 5)) });
});
app.post('/inventory/seed', requireAuth, (req, res) => {
  const dealer = resolveDealer(req, res); if (!dealer) return;
  if (!Array.isArray(req.body?.vehicles)) return res.status(400).json({ ok: false, error: 'vehicles array required' });
  loadSeed(dealer.dealer_id, req.body.vehicles);
  res.json({ ok: true, count: req.body.vehicles.length });
});

app.use((err, _req, res, _next) => {
  if (err instanceof z.ZodError) return res.status(400).json({ success: false, status: 'bad_request', issues: err.issues });
  console.error('unhandled', err);
  res.status(500).json({ success: false, status: 'server_error', message: err?.message || String(err) });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(JSON.stringify({ event: 'listening', service: SERVICE, port: Number(PORT), lead_mode: LEAD_MODE, dealers: allDealers().map((d) => d.dealer_id) }));
    startScheduler();
  });
}
export default app;
