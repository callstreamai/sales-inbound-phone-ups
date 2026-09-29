// Ranks cached vehicles against what the caller said. Tolerant of spoken input
// ("rav four", "tacoma t r d off road", "the hybrid one").

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const squash = (s) => norm(s).replace(/\s+/g, '');
const SPOKEN = [[/\brav ?four\b/g, 'rav4'], [/\bfour ?runner\b/g, '4runner'], [/\bc ?h ?r\b/g, 'chr'], [/\bb ?z ?4 ?x\b/g, 'bz4x'], [/\bt ?r ?d\b/g, 'trd'], [/\bx ?s ?e\b/g, 'xse'], [/\bx ?l ?e\b/g, 'xle'], [/\bs ?r ?5\b/g, 'sr5'], [/\bg ?r\b/g, 'gr']];
function spoken(s) { let t = norm(s); for (const [re, rep] of SPOKEN) t = t.replace(re, rep); return t; }

function modelMatch(v, want) {
  if (!want) return 0;
  const a = squash(spoken(v.model)), b = squash(spoken(want));
  if (!b) return 0;
  if (a === b) return 3;
  if (a.startsWith(b) || b.startsWith(a)) return 2;
  if (a.includes(b) || b.includes(a)) return 1;
  // "corolla cross hybrid" asked, vehicle model "Corolla Cross" with hybrid fuel
  const words = spoken(want).split(' ').filter(Boolean);
  const hay = squash(spoken(`${v.model} ${v.trim} ${v.fuel} ${v.body}`));
  return words.every((w) => hay.includes(squash(w))) ? 1 : -1;
}
function textMatch(field, want) {
  if (!want) return 0;
  const a = squash(spoken(field)), b = squash(spoken(want));
  if (!b) return 0;
  if (!a) return -1;
  return a.includes(b) || b.includes(a) ? 1 : -1;
}

// Known model names, longest first so "Corolla Cross" wins over "Corolla".
const MODELS = ['grand highlander', 'corolla cross', 'land cruiser', 'rav4 prime', 'prius prime', 'gr corolla', 'gr supra', 'highlander', 'sequoia', 'tacoma', 'tundra', '4runner', 'corolla', 'camry', 'sienna', 'prius', 'crown', 'bz4x', 'rav4', 'gr86', 'supra', 'venza', 'mirai', 'chr', 'avalon', 'yaris'];
export function detectModel(text) {
  const t = ' ' + spoken(text) + ' ';
  for (const m of MODELS) { const re = new RegExp('\\b' + m.replace(/ /g, ' ?') + 's?\\b'); if (re.test(t)) return m; }
  return '';
}

const clean = (x) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export function stockMatches(v, stock) {
  const want = clean(stock);
  if (want.length < 4) return false;
  const pool = [v.stock, ...(v.stock_alts || []), ...(v.ids || [])].map(clean).filter(Boolean);
  if (pool.includes(want)) return true;
  // Callers often read the last 6-8 characters of the VIN as the "stock number".
  return want.length >= 6 && want.length <= 8 && clean(v.vin).endsWith(want);
}
export function findByStockOrVin(vehicles, { stock, vin }) {
  if (vin && clean(vin).length === 17) { const hit = vehicles.find((v) => v.vin === clean(vin)); if (hit) return hit; }
  if (stock) return vehicles.find((v) => stockMatches(v, stock)) || null;
  return null;
}

export function searchVehicles(vehicles, q) {
  const wantCond = q.condition ? norm(q.condition) : '';
  const wantHybrid = /hybrid|plug|phev|electric|ev\b/.test(norm(q.fuel_type || ''));
  const scored = [];
  for (const v of vehicles) {
    let score = 0;
    const notes = [];
    if (wantCond) {
      const ok = wantCond === 'new' ? v.condition === 'new' : wantCond === 'certified' ? v.condition === 'certified' : v.condition !== 'new';
      if (!ok) continue;
    }
    if (q.stock && stockMatches(v, q.stock)) score += 100;
    if (q.vin && v.vin === String(q.vin).toUpperCase()) score += 100;
    if (q.make) { const m = textMatch(v.make, q.make); if (m < 0) continue; score += m * 2; }
    if (q.model) { const m = modelMatch(v, q.model); if (m < 0) continue; score += m * 10; }
    if (q.year) { const y = Number(q.year); if (v.year === y) score += 6; else if (Math.abs(v.year - y) <= 1) { score += 1; notes.push('year_near'); } else continue; }
    if (q.trim) { const a = squash(spoken(v.trim)), b = squash(spoken(q.trim)); const m = a && b && (a === b || a.startsWith(b) || (b.length >= 6 && b.startsWith(a) && a.length >= 4)) ? 1 : -1; if (m > 0) score += 8; else notes.push('trim_miss'); }
    if (q.fuel_type) { const hay = norm(`${v.fuel} ${v.model} ${v.trim} ${v.engine}`); const isHybrid = /hybrid|plug|phev|electric|\bev\b|i force max/.test(hay); if (wantHybrid ? isHybrid : true) score += wantHybrid ? 6 : 0; else notes.push('fuel_miss'); }
    if (q.body_style) { const m = textMatch(`${v.body} ${v.model}`, q.body_style); if (m > 0) score += 3; else if (m < 0) notes.push('body_miss'); }
    if (q.color) { const m = textMatch(v.exterior_color, q.color); if (m > 0) score += 4; else notes.push('color_miss'); }
    if (q.max_price && v.price) { if (v.price <= Number(q.max_price)) score += 3; else if (v.price <= Number(q.max_price) * 1.08) { score -= 2; notes.push('slightly_over_budget'); } else continue; }
    if (q.max_mileage && v.mileage != null && v.mileage > Number(q.max_mileage)) continue;
    if (v.in_transit) score -= 1;
    scored.push({ v, score, notes });
  }
  scored.sort((a, b) => b.score - a.score || (a.v.price || 1e9) - (b.v.price || 1e9));
  // Exact-ish matches (no soft misses) rank above ones that missed a soft preference.
  const clean = scored.filter((s) => !s.notes.length);
  const ordered = clean.length ? [...clean, ...scored.filter((s) => s.notes.length)] : scored;
  return { matches: ordered.map((s) => s.v), notes: ordered.slice(0, 3).map((s) => s.notes), relaxed: !clean.length && scored.length > 0 };
}

// Facets that help the agent refine ("we have it in XLE and Limited").
export function facets(vehicles) {
  const count = (key, fn) => { const m = new Map(); for (const v of vehicles) { const k = fn(v); if (k) m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n})`); };
  const prices = vehicles.map((v) => v.price).filter(Boolean);
  return {
    trims: count('trim', (v) => v.trim).slice(0, 8),
    colors: count('color', (v) => v.exterior_color).slice(0, 8),
    years: count('year', (v) => String(v.year)),
    price_low: prices.length ? Math.min(...prices) : null,
    price_high: prices.length ? Math.max(...prices) : null,
  };
}
