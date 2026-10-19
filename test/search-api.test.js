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


test('multiple interests preserve groups, fair slots, alternatives and corrections', async () => {
  const dealer_id = 'balise-toyota-warwick';
  const base = { year: 2026, make: 'Toyota', model: 'Corolla', condition: 'new', trim: 'LE', price: 25000, price_type: 'msrp', features: [], exterior_color: 'Ice Cap' };
  loadSeed(dealer_id, [
    ...[1, 2, 3, 4].map(i => ({ ...base, vin: String(i).repeat(17), stock: 'C' + i })),
    { ...base, vin: 'R'.repeat(17), stock: 'R001', model: '4Runner', price: 47000 },
    { ...base, vin: 'X'.repeat(17), stock: 'X1', model: 'Corolla Cross' },
  ]);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const search = async body => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/inventory/search`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dealer_id, ...body }),
    });
    return { code: response.status, ...await response.json() };
  };
  try {
    for (const query of [
      { model: 'Corolla, 4Runner' }, { model: 'Corolla or 4 Runner' },
      { models: ['Corolla', 'four runner', 'Corollas'] },
      { vehicle_interest_text: 'Interested in a Corolla and a 4Runner' },
    ]) {
      const r = await search({ ...query, condition: 'new', color: 'white' });
      assert.equal(r.status, 'match');
      assert.equal(r.multi_model, true);
      assert.deepEqual(r.requested_models, ['corolla', '4runner']);
      assert.deepEqual(r.model_results.map(g => g.match_count), [4, 1]);
      assert.equal(r.match_count, 5);
      assert.equal(r.vehicle_1_model, 'Corolla');
      assert.equal(r.vehicle_2_model, '4Runner');
      assert.equal(r.vehicle_3_model, 'Corolla');
      assert.match(r.results_spoken, /Corolla.*4Runner/);
      assert.deepEqual(JSON.parse(r.model_results_json), r.model_results);
    }
    const missing = await search({ models: ['Corolla', 'Tacoma'] });
    assert.equal(missing.status, 'partial_match');
    assert.equal(missing.model_results[1].status, 'no_match');
    assert.match(missing.results_spoken, /tacoma.*no matching listings/i);
    const corrected = await search({ model: '4Runner', vehicle_interest_text: 'Previously wanted Corolla and 4Runner' });
    assert.equal(corrected.multi_model, false);
    assert.equal(corrected.vehicle_1_model, '4Runner');
    assert.equal(corrected.vehicle_2_model, '');
    assert.equal(corrected.model_results_json, '[]');
    const specific = await search({ models: ['Corolla', '4Runner'], stock: 'R001' });
    assert.equal(specific.stock_found, true);
    assert.equal(specific.match_count, 1);
    assert.equal(specific.multi_model, false);
    const separate = await search({ models: ['Corolla Cross', 'Corolla'] });
    assert.deepEqual(separate.model_results.map(g => g.match_count), [1, 4]);
    const alternative = await search({ models: ['Corolla', '4Runner'], max_price: 30000 });
    assert.equal(alternative.status, 'partial_match');
    assert.equal(alternative.exact_match_count, 4);
    assert.equal(alternative.alternative_count, 1);
    assert.match(alternative.results_spoken, /4Runner.*alternative/);
    assert.match(alternative.relaxed_note, /max_price/);
    const none = await search({ models: ['Tacoma', 'Tundra'] });
    assert.equal(none.status, 'no_match');
    assert.equal(none.vehicle_1_stock, '');
    assert.equal((await search({ models: Array(9).fill('Corolla') })).code, 400);
    assert.equal((await search({ models: [42] })).code, 400);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
