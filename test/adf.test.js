import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdf } from '../src/lead/adf.js';

test('builds valid ADF with vehicle, trade and escaped text', () => {
  const xml = buildAdf({
    dealer: { name: 'Balise Toyota of Warwick', sales_phone: '+14013525911' },
    customer: { name: 'Mary Ann Smith', phone: '4015550123', email: 'mary@example.com' },
    vehicle: { condition: 'new', year: 2026, make: 'Toyota', model: 'RAV4', trim: 'XLE', vin: '2T3RWRFV5PW123456', stock: 'T26123', exterior_color: 'Blue', price: 35995, price_type: 'listed' },
    trade: { has_trade: true, year: 2018, make: 'Honda', model: 'CR-V' },
    timeframe: 'this weekend', comments: 'Wants AWD & <heated seats>', call_id: 'call_123',
    requestdate: new Date('2026-09-28T15:00:00Z'),
  });
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<\?adf version="1.0"\?>\n<adf><prospect status="new">/);
  assert.match(xml, /<requestdate>2026-09-28T15:00:00\+00:00<\/requestdate>/);
  assert.match(xml, /<vehicle interest="buy" status="new"><year>2026<\/year><make>Toyota<\/make><model>RAV4<\/model><trim>XLE<\/trim><vin>2T3RWRFV5PW123456<\/vin><stock>T26123<\/stock>/);
  assert.match(xml, /<price type="quote" currency="USD">35995<\/price>/);
  assert.match(xml, /<vehicle interest="trade-in" status="used"><year>2018<\/year><make>Honda<\/make><model>CR-V<\/model><\/vehicle>/);
  assert.match(xml, /<name part="first">Mary Ann<\/name><name part="last">Smith<\/name>/);
  assert.match(xml, /Wants AWD &amp; &lt;heated seats&gt;/);
  assert.match(xml, /<vendor><vendorname>Balise Toyota of Warwick<\/vendorname>/);
  assert.match(xml, /<provider><name part="full">Alpha Drive AI<\/name>/);
  assert.match(xml, /<\/prospect><\/adf>$/);
});

test('no vehicle block when nothing was chosen', () => {
  const xml = buildAdf({ dealer: { name: 'X' }, customer: { name: 'Bob' }, vehicle: null, trade: { has_trade: false } });
  assert.doesNotMatch(xml, /interest="buy"/);
  assert.match(xml, /Trade-in: no/);
});
