// Turns whatever JSON a dealer website loads into one common vehicle shape.
// Platform-agnostic on purpose: it walks the payload looking for objects that carry a
// valid 17-character VIN, then maps nearby fields by name. That survives the small field
// renames DealerOn and Dealer.com push without notice.

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i;

const FIELDS = {
  year: [/^(vehicle)?year$/, /modelyear/],
  make: [/^(vehicle)?make(name)?$/],
  model: [/^(vehicle)?model(name)?$/],
  trim: [/^(vehicle)?trim(name|level)?$/, /^(vehicle)?series$/],
  stock: [/^(vehicle)?stock(number|num|no|id)$/, /^stk(number|num|no)?$/],
  body: [/body(style|type)?$/],
  exterior_color: [/^(vehicle)?(exterior|ext)(color|colour)(name|label|generic|description)?$/, /^(vehicle)?color(name|label)?$/],
  interior_color: [/^(vehicle)?(interior|int)(color|colour)(name|label|description)?$/],
  mileage: [/^(vehicle)?(odometer|mileage|miles)$/],
  fuel: [/fuel(type)?$/],
  drivetrain: [/^(vehicle)?(drivetrain|drive(type|line)?)$/],
  engine: [/^(vehicle)?engine(description)?$/],
  transmission: [/^(vehicle)?transmission(description)?$/],
  url: [/(vdp|detail)(url|link|page)$/, /^link$/, /^url$/, /vehicle(url|link)$/],
  condition: [/^(vehicle)?(condition|type|inventorytype|newused|status)$/],
  certified: [/certified/, /^cpo$/],
  in_transit: [/intransit/, /^transit/],
};
// Order matters: the first price type found wins.
const PRICE_PREF = [/internet|sale|selling|final|dealer|our|special|dprice|asking/, /^price$|retail(price)?$|^displayprice/, /msrp|tsrp|srp|list/];

function number(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}
function str(v) {
  if (v == null || typeof v === 'object') return '';
  return String(v).trim();
}

// Flatten an object's own scalars plus two nested levels, keys lowercased with no punctuation.
// Shallower keys win, so a vehicle's own fields beat anything inside a sub-model.
function flat(obj) {
  const out = {};
  const put = (k, v) => {
    const key = k.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!(key in out)) out[key] = v;
  };
  const scalars = (o) => Object.entries(o).filter(([, v]) => v != null && typeof v !== 'object');
  const children = (o) => Object.values(o).filter((v) => v && typeof v === 'object' && !Array.isArray(v));
  for (const [k, v] of scalars(obj)) put(k, v);
  const level1 = children(obj);
  for (const c of level1) for (const [k, v] of scalars(c)) put(k, v);
  for (const c of level1) for (const cc of children(c)) for (const [k, v] of scalars(cc)) put(k, v);
  return out;
}

function pick(f, patterns) {
  for (const re of patterns) for (const [k, v] of Object.entries(f)) if (re.test(k) && str(v) && typeof v !== 'boolean' && !/^#[0-9a-f]{3,8}$/i.test(str(v))) return v;
  return null;
}

// Collect every price-looking pair reachable from a vehicle object (bounded depth).
function prices(obj, depth = 0, acc = []) {
  if (!obj || typeof obj !== 'object' || depth > 3) return acc;
  if (Array.isArray(obj)) { for (const x of obj) prices(x, depth + 1, acc); return acc; }
  const label = str(obj.label || obj.Label || obj.name || obj.Name || obj.type || obj.Type).toLowerCase();
  for (const [k, v] of Object.entries(obj)) {
    const key = k.toLowerCase();
    if (v && typeof v === 'object') { prices(v, depth + 1, acc); continue; }
    if (!/price|msrp|srp|value|amount/.test(key)) continue;
    if (/payment|monthly|lease|apr|rate|term|saving|discount|rebate|incentive|fee|tax/.test(key + ' ' + label)) continue;
    const n = number(v);
    if (n && n >= 1000 && n < 1000000) acc.push({ key: key === 'value' || key === 'amount' ? (label || key) : key, n });
  }
  return acc;
}

function bestPrice(obj) {
  const all = prices(obj);
  for (const re of PRICE_PREF) {
    const hit = all.find((p) => re.test(p.key));
    if (hit) return { price: hit.n, price_type: /msrp|tsrp|srp|list/.test(hit.key) ? 'msrp' : 'listed' };
  }
  return { price: null, price_type: null };
}

function conditionOf(f, fallback) {
  const cert = pick(f, FIELDS.certified);
  if (cert === true || /^(true|yes|1|y)$/i.test(str(cert))) return 'certified';
  const c = str(pick(f, FIELDS.condition)).toLowerCase();
  if (/certif|cpo/.test(c)) return 'certified';
  if (/used|pre-?owned/.test(c)) return 'used';
  if (/^new/.test(c)) return 'new';
  return fallback || 'unknown';
}

export function toVehicle(obj, { condition, baseUrl } = {}) {
  const f = flat(obj);
  const vin = Object.entries(f).find(([k, v]) => /vin/.test(k) && VIN_RE.test(str(v)));
  if (!vin) return null;
  const year = number(pick(f, FIELDS.year));
  const model = str(pick(f, FIELDS.model));
  if (!year || year < 1980 || year > 2100 || !model) return null;
  const { price, price_type } = bestPrice(obj);
  let url = str(pick(f, FIELDS.url));
  if (url && baseUrl && url.startsWith('/')) url = baseUrl.replace(/\/$/, '') + url;
  const transit = pick(f, FIELDS.in_transit);
  return {
    vin: str(vin[1]).toUpperCase(),
    stock: str(pick(f, FIELDS.stock)),
    condition: conditionOf(f, condition),
    year,
    make: str(pick(f, FIELDS.make)),
    model,
    trim: str(pick(f, FIELDS.trim)),
    body: str(pick(f, FIELDS.body)),
    exterior_color: str(pick(f, FIELDS.exterior_color)),
    interior_color: str(pick(f, FIELDS.interior_color)),
    mileage: number(pick(f, FIELDS.mileage)),
    fuel: str(pick(f, FIELDS.fuel)),
    drivetrain: str(pick(f, FIELDS.drivetrain)),
    engine: str(pick(f, FIELDS.engine)),
    transmission: str(pick(f, FIELDS.transmission)),
    in_transit: transit === true || /^(true|yes|1)$/i.test(str(transit)),
    price,
    price_type,
    url,
  };
}

// Walk any JSON payload and return every distinct vehicle found in it.
export function extractVehicles(payload, opts = {}) {
  const found = new Map();
  const seen = new Set();
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 12 || seen.has(node)) return;
    seen.add(node);
    if (!Array.isArray(node)) {
      const v = toVehicle(node, opts);
      if (v) { if (!found.has(v.vin)) found.set(v.vin, v); return; }
    }
    for (const child of Array.isArray(node) ? node : Object.values(node)) walk(child, depth + 1);
  };
  walk(payload, 0);
  return [...found.values()];
}
