// Dealer registry. Adding a dealer is a config entry, not a code change.
// Source: DEALERS_JSON env var (full JSON array) if set, else config/dealers.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function load() {
  const raw = process.env.DEALERS_JSON || fs.readFileSync(path.join(here, '..', 'config', 'dealers.json'), 'utf8');
  const list = JSON.parse(raw);
  if (!Array.isArray(list)) throw new Error('Dealer config must be a JSON array');
  for (const d of list) {
    if (!d.dealer_id || !d.name || !d.platform || !d.website) throw new Error('Dealer entry missing dealer_id, name, platform, or website');
    if (!['dealeron', 'dealercom'].includes(d.platform)) throw new Error(`Unsupported platform "${d.platform}" for ${d.dealer_id}`);
  }
  return list;
}

let dealers = load();
export function allDealers() { return dealers; }
export function reloadDealers() { dealers = load(); return dealers; }

const digits = (s) => String(s || '').replace(/\D/g, '').slice(-10);

// Resolve by explicit dealer_id first, then by the number the caller dialed.
export function findDealer({ dealer_id, to } = {}) {
  if (dealer_id) {
    const d = dealers.find((x) => x.dealer_id === dealer_id);
    if (d) return d;
  }
  if (to) {
    const t = digits(to);
    const d = dealers.find((x) => (x.inbound_numbers || []).some((n) => digits(n) === t));
    if (d) return d;
  }
  // Single-dealer deployments resolve regardless of the dialed number.
  if (dealers.length === 1) return dealers[0];
  return null;
}

// Local wall-clock parts for a timezone without extra dependencies.
function localParts(tz, now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const day = parts.weekday.slice(0, 3).toLowerCase();
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return { day, hhmm: `${hour}:${parts.minute}` };
}

function spokenTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, '0')} ${suffix}` : `${h12} ${suffix}`;
}

export function salesStatus(dealer, now = new Date()) {
  const tz = dealer.timezone || 'America/New_York';
  const { day, hhmm } = localParts(tz, now);
  const today = dealer.sales_hours ? dealer.sales_hours[day] : null;
  const open = Boolean(today && hhmm >= today[0] && hhmm < today[1]);
  // Next opening, for after-hours wording.
  let next = null;
  const idx = DAYS.indexOf(day);
  for (let i = 0; i < 8 && dealer.sales_hours; i++) {
    const d = DAYS[(idx + i) % 7];
    const hrs = dealer.sales_hours[d];
    if (!hrs) continue;
    if (i === 0 && hhmm >= hrs[0]) continue;
    const dayName = i === 0 ? 'today' : i === 1 ? 'tomorrow' : { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' }[d];
    next = `${dayName} at ${spokenTime(hrs[0])}`;
    break;
  }
  return {
    sales_open: open,
    sales_hours_today: today ? `${spokenTime(today[0])} to ${spokenTime(today[1])}` : 'closed today',
    sales_next_open: open ? '' : (next || ''),
  };
}
