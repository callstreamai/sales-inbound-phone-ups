// Spoken-form helpers. Everything here is read aloud by the voice agent, so keep it short
// and avoid symbols the TTS might read oddly.

export function spokenPrice(n) {
  if (!n) return '';
  return `${Math.round(n).toLocaleString('en-US')} dollars`;
}

export function spokenVehicle(v, { withPrice = true, withStock = false } = {}) {
  const parts = [`a ${v.year} ${v.make} ${v.model}${v.trim ? ' ' + v.trim : ''}`.trim()];
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
  const lead = total === 1 ? `I found one ${what} in stock:` : `I found ${total} ${what}${total > 3 ? ', here are three of them' : ''}:`;
  const list = top.map((v, i) => `${['First', 'Second', 'Third'][i]}, ${spokenVehicle(v)}`).join('. ');
  return `${lead} ${list}.`;
}
