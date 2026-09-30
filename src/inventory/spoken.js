// Spoken-form helpers. Everything here is read aloud by the voice agent, so keep it short
// and avoid symbols the TTS might read oddly.

export function spokenPrice(n) {
  if (!n) return '';
  return `${Math.round(n).toLocaleString('en-US')} dollars`;
}

// DealerOn often repeats the model inside the trim ("Tundra" + "Tundra Limited"); drop the repeat.
export function cleanTrim(model, trim) {
  if (!trim) return '';
  const words = new Set(String(model || '').toLowerCase().split(/\s+/).filter(Boolean));
  const kept = String(trim).split(/\s+/).filter((w) => !words.has(w.toLowerCase()));
  return kept.join(' ').trim();
}
export function spokenVehicle(v, { withPrice = true, withStock = false } = {}) {
  const t = cleanTrim(v.model, v.trim);
  const parts = [`a ${v.year} ${v.make} ${v.model}${t ? ' ' + t : ''}`.trim()];
  if (v.exterior_color) parts.push(`in ${v.exterior_color}`);
  if (v.condition !== 'new' && v.mileage) parts.push(`with ${Math.round(v.mileage).toLocaleString('en-US')} miles`);
  if (withPrice && v.price) parts.push(v.price_type === 'msrp' ? `with an M S R P of ${spokenPrice(v.price)}` : `listed at ${spokenPrice(v.price)}`);
  if (v.in_transit) parts.push('which is in transit to the dealership');
  if (withStock && v.stock) parts.push(`stock number ${v.stock.split('').join(' ')}`);
  return parts.join(', ');
}

export function spokenResults(matches, total, q) {
  if (!matches.length) return '';
  const top = matches.slice(0, 3);
  const m = matches[0];
  const what = [q.year, q.make ? m.make : '', q.model ? m.model : '', q.trim && matches.every((v) => v.trim === m.trim) ? m.trim : ''].filter(Boolean).join(' ') || 'that';
  const plural = /[sxz]$/i.test(what) ? what : what + 's';
  const lead = total === 1 ? `I found one ${what} in stock:` : `I found ${total} ${plural}${total > 3 ? ', here are three of them' : ''}:`;
  const list = top.map((v, i) => `${['First', 'Second', 'Third'][i]}, ${spokenVehicle(v)}`).join('. ');
  return `${lead} ${list}.`;
}

// One or two sentences of unit detail the agent can read when asked "what's it got?".
export function spokenDetails(v) {
  const bits = [];
  if (v.interior_color) bits.push(`a ${v.interior_color} interior`);
  if (v.drivetrain) bits.push(/4|four|awd|all/i.test(v.drivetrain) ? v.drivetrain.replace(/^4WD$/i, 'four wheel drive').replace(/^AWD$/i, 'all wheel drive') : v.drivetrain);
  if (v.engine) bits.push(/engine/i.test(v.engine) ? `the ${v.engine}` : `the ${v.engine} engine`);
  if (v.transmission) bits.push(`${/auto/i.test(v.transmission) ? 'an automatic' : v.transmission} transmission`);
  let out = bits.length ? `It has ${bits.slice(0, -1).join(', ')}${bits.length > 1 ? ' and ' : ''}${bits[bits.length - 1]}.` : '';
  if (v.features && v.features.length) out += ` Highlights include ${v.features.slice(0, 6).join(', ')}.`;
  out = out.replace(/[®™©]/g, '');
  if (v.in_transit) out += ' It is currently in transit to the dealership.';
  return out.trim();
}
