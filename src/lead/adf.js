// ADF 1.0 lead XML. Every CRM the dealers use (VinSolutions, DealerSocket, Elead, Tekion,
// DriveCentric) parses this format from a plain-text email body.

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tag = (name, value, attrs = '') => (value === '' || value == null ? '' : `<${name}${attrs ? ' ' + attrs : ''}>${esc(value)}</${name}>`);

function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: parts[0] || '', last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

function adfDate(d = new Date()) {
  // ADF wants ISO 8601 with offset; UTC "Z" is accepted by all major CRMs.
  return d.toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

export function buildAdf({ dealer, customer, vehicle, comments, trade, timeframe, call_id, provider = 'Alpha Drive AI', requestdate = new Date() }) {
  const name = splitName(customer.name);
  const status = vehicle?.condition === 'new' ? 'new' : vehicle?.condition ? 'used' : '';
  const vehicleXml = vehicle && (vehicle.model || vehicle.vin)
    ? `<vehicle interest="buy"${status ? ` status="${status}"` : ''}>` +
      tag('year', vehicle.year) + tag('make', vehicle.make) + tag('model', vehicle.model) + tag('trim', vehicle.trim) +
      tag('vin', vehicle.vin) + tag('stock', vehicle.stock) + tag('bodystyle', vehicle.body) +
      (vehicle.exterior_color ? `<colorcombination>${tag('exteriorcolor', vehicle.exterior_color)}${tag('interiorcolor', vehicle.interior_color)}</colorcombination>` : '') +
      (vehicle.price ? `<price type="${vehicle.price_type === 'msrp' ? 'msrp' : 'quote'}" currency="USD">${esc(vehicle.price)}</price>` : '') +
      (vehicle.mileage ? tag('odometer', Math.round(vehicle.mileage), 'units="miles"') : '') +
      '</vehicle>'
    : '';
  const tradeXml = trade && trade.has_trade && (trade.model || trade.description)
    ? `<vehicle interest="trade-in" status="used">` + tag('year', trade.year) + tag('make', trade.make) + tag('model', trade.model) + tag('comments', trade.description) + '</vehicle>'
    : '';
  const commentLines = [
    comments,
    timeframe ? `Timeframe: ${timeframe}` : '',
    trade && trade.has_trade ? `Trade-in: ${[trade.year, trade.make, trade.model].filter(Boolean).join(' ') || trade.description || 'yes'}` : 'Trade-in: no',
    call_id ? `Source: inbound phone call handled by ${provider}. Call ID ${call_id}.` : `Source: inbound phone call handled by ${provider}.`,
  ].filter(Boolean).join('\n');
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n<?adf version="1.0"?>\n<adf><prospect status="new">` +
    tag('requestdate', adfDate(requestdate)) +
    vehicleXml + tradeXml +
    `<customer><contact>` +
    tag('name', name.first, 'part="first"') + tag('name', name.last, 'part="last"') +
    tag('email', customer.email) +
    (customer.phone ? tag('phone', customer.phone, 'type="voice" time="nopreference"') : '') +
    `</contact>` + tag('comments', commentLines) + (timeframe ? tag('timeframe', timeframe) : '') + `</customer>` +
    `<vendor>` + tag('vendorname', dealer.name) + `<contact>` + tag('name', dealer.name, 'part="full"') +
    (dealer.sales_phone ? tag('phone', dealer.sales_phone, 'type="voice"') : '') + `</contact></vendor>` +
    `<provider>` + tag('name', provider, 'part="full"') + tag('service', 'Inbound sales call AI agent') + `</provider>` +
    `</prospect></adf>`;
  return xml;
}
