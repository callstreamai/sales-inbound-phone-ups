import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
process.env.WEBHOOK_SECRET = '';
const { default: app } = await import('../src/server.js');
const { loadSeed } = await import('../src/inventory/cache.js');

test('inventory endpoint separates exact matches and year alternatives', async () => {
  const dealer_id = 'balise-toyota-warwick';
  const base = { year: 2026, make: 'Toyota', model: 'Corolla', condition: 'new', trim: 'LE', price: 25000, price_type: 'msrp', features: [] };
  loadSeed(dealer_id, [
    { ...base, vin: 'A'.repeat(17), stock: 'W001', exterior_color: 'Ice Cap' },
    { ...base, vin: 'B'.repeat(17), stock: 'W002', exterior_color: 'Wind Chill Pearl <a href="x">17</a>' },
    { ...base, vin: 'C'.repeat(17), stock: 'GRAY', exterior_color: 'Underground' },
    { ...base, vin: 'D'.repeat(17), stock: 'CROSS', model: 'Corolla Cross', exterior_color: 'Ice Cap' },
  ]);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const search = async body => (await fetch(`http://127.0.0.1:${server.address().port}/inventory/search`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dealer_id, ...body }),
  })).json();
  try {
    const exact = await search({ model: 'Corolla', color: 'white', condition: 'new' });
    assert.equal(exact.status, 'match');
    assert.equal(exact.match_count, 2);
    assert.equal(exact.exact_match_count, 2);
    assert.equal(exact.vehicle_2_color, 'Wind Chill Pearl');
    assert.equal(exact.vehicle_3_stock, '');
    assert.equal(exact.alternative_count, 0);
    const alternative = await search({ model: 'Corolla', year: 2027, color: 'white' });
    assert.equal(alternative.status, 'partial_match');
    assert.equal(alternative.exact_match_count, 0);
    assert.match(alternative.relaxed_note, /model year/);
    assert.doesNotMatch(alternative.results_spoken, /2027/);
    const stock = await search({ stock: 'GRAY' });
    assert.equal(stock.stock_found, true);
    assert.equal(stock.vehicle_1_stock, 'GRAY');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
