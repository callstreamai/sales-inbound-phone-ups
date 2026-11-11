import test from 'node:test';
import assert from 'node:assert/strict';
import { searchVehicles, facets, detectModels, requestedModels } from '../src/inventory/search.js';
import { spokenResults } from '../src/inventory/spoken.js';

const inv = [
  { vin: 'A'.repeat(17), stock: '1', condition: 'new', year: 2026, make: 'Toyota', model: 'RAV4', trim: 'XLE', exterior_color: 'Blue', fuel: 'Hybrid', price: 36000, body: 'SUV' },
  { vin: 'B'.repeat(17), stock: '2', condition: 'new', year: 2026, make: 'Toyota', model: 'RAV4', trim: 'LE', exterior_color: 'White', fuel: 'Gas', price: 31000, body: 'SUV' },
  { vin: 'C'.repeat(17), stock: '3', condition: 'used', year: 2023, make: 'Toyota', model: 'RAV4', trim: 'XLE', exterior_color: 'Blue', fuel: 'Gas', price: 27000, mileage: 30000, body: 'SUV' },
  { vin: 'D'.repeat(17), stock: '4', condition: 'new', year: 2026, make: 'Toyota', model: 'Tacoma', trim: 'TRD Off-Road', exterior_color: 'Bronze', fuel: 'Gas', price: 45000, body: 'Truck' },
];

test('spoken model names match', () => {
  const r = searchVehicles(inv, { condition: 'new', model: 'rav four' });
  assert.equal(r.matches.length, 2);
  const t = searchVehicles(inv, { model: 'tacoma t r d off road' });
  assert.equal(t.matches[0].stock, '4');
});

test('exact hybrid matches exclude gas alternatives', () => {
  const r = searchVehicles(inv, { condition: 'new', model: 'RAV4', fuel_type: 'hybrid' });
  assert.equal(r.matches[0].stock, '1');
  assert.equal(r.matches.length, 1);
});

test('budget is a hard filter with a small tolerance', () => {
  const r = searchVehicles(inv, { model: 'RAV4', max_price: 30000 });
  assert.deepEqual(r.matches.map((v) => v.stock), ['3']); // Never mix an over-budget alternative into exact matches
  assert.equal(searchVehicles(inv, { model: 'RAV4', max_price: 28000 }).matches.length, 1);
  const r2 = searchVehicles(inv, { model: 'RAV4', max_price: 33000 });
  assert.equal(r2.matches.length, 2);
  assert.equal(r2.matches[0].stock, '3'); // clean match before slightly-over
});

test('condition filter and facets', () => {
  const r = searchVehicles(inv, { condition: 'used', model: 'RAV4' });
  assert.equal(r.matches.length, 1);
  const f = facets(searchVehicles(inv, { condition: 'new', model: 'RAV4' }).matches);
  assert.deepEqual([...f.trims].sort(), ['LE (1)', 'XLE (1)']);
  assert.equal(f.price_low, 31000);
});

test('spoken results', () => {
  const r = searchVehicles(inv, { condition: 'new', model: 'RAV4' });
  const s = spokenResults(r.matches.slice(0, 3), r.matches.length, { model: 'RAV4' });
  assert.match(s, /I found 2 RAV4s: First, a 2026 Toyota RAV4/);
  const s2 = spokenResults(r.matches.slice(0, 3), r.matches.length, { model: 'rav four' });
  assert.match(s2, /I found 2 RAV4s:/);
  assert.match(s, /36,000 dollars/);
});

test('white Corolla excludes other models and nonwhite alternatives', () => {
  const base = { condition: 'new', year: 2027, make: 'Toyota', model: 'Corolla', price: 25000 };
  const vehicles = [
    { ...base, stock: 'white1', exterior_color: 'Ice Cap' },
    { ...base, stock: 'white2', exterior_color: 'Wind Chill Pearl <a href="x"><sup>17</sup></a>' },
    { ...base, stock: 'gray', exterior_color: 'Underground' },
    { ...base, stock: 'cross', model: 'Corolla Cross', exterior_color: 'Ice Cap' },
    { ...base, stock: 'gr', model: 'GR Corolla', exterior_color: 'Ice Cap' },
  ];
  const r = searchVehicles(vehicles, { condition: 'new', model: 'Corolla', color: 'white' });
  assert.deepEqual(r.matches.map(v => v.stock), ['white1', 'white2']);
  assert.equal(r.relaxed, false);
  assert.equal(r.exact_count, 2);
  assert.doesNotMatch(spokenResults(r.matches, 2, { model: 'Corolla' }), /<|href|sup>/);
});

test('specific color does not widen to another white paint', () => {
  const r = searchVehicles([
    { ...inv[1], exterior_color: 'Ice Cap' },
    { ...inv[1], stock: 'pearl', exterior_color: 'Wind Chill Pearl' },
  ], { color: 'Wind Chill Pearl' });
  assert.deepEqual(r.matches.map(v => v.stock), ['pearl']);
});

test('year fallback is explicitly an alternative and never announced as requested year', () => {
  const r = searchVehicles(inv, { condition: 'new', model: 'RAV4', year: 2027 });
  assert.equal(r.relaxed, true);
  assert.equal(r.exact_count, 0);
  const speech = spokenResults(r.matches, r.matches.length, { model: 'RAV4', year: 2027 }, { relaxed: true });
  assert.match(speech, /alternative/);
  assert.doesNotMatch(speech, /2027/);
});

test('a 4Runner search cannot return Corolla inventory', () => {
  const r = searchVehicles([{ ...inv[1], model: 'Corolla' }, { ...inv[1], model: '4Runner', stock: 'runner' }], { model: 'four runner' });
  assert.deepEqual(r.matches.map(v => v.stock), ['runner']);
});


test('model interests preserve order and distinct Toyota names', () => {
  assert.deepEqual(detectModels('Corolla Cross or Corolla, then a four runner'), ['corolla cross', 'corolla', '4runner']);
  assert.deepEqual(detectModels('GR Corolla and Corolla Hybrid'), ['gr corolla', 'corolla hybrid']);
  assert.deepEqual(requestedModels({ model: 'Tacoma TRD Off Road' }), ['tacoma trd off road']);
  assert.deepEqual(requestedModels({ model: 'Corolla/4Runner' }), ['corolla', '4runner']);
  assert.deepEqual(requestedModels({ model: 'Corolla 4Runner' }), ['corolla', '4runner']);
  assert.deepEqual(requestedModels({ models: ['Civic', 'Accord'] }), ['civic', 'accord']);
});

test('both or undecided retains both conditions; explicit conditions narrow', () => {
  for (const condition of ['', 'both', 'either', 'not sure', 'new and used']) {
    assert.equal(searchVehicles(inv, { model: 'RAV4', condition }).matches.length, 3);
  }
  assert.equal(searchVehicles(inv, { model: 'RAV4', condition: 'new' }).matches.length, 2);
  assert.equal(searchVehicles(inv, { model: 'RAV4', condition: 'used' }).matches.length, 1);
});

test('bZ legacy alias matches seven regular units and never Woodland', () => {
  const ev = { ...inv[0], model: 'bZ', fuel: 'Electric Fuel System' };
  const vehicles = [
    ...Array.from({ length: 6 }, (_, i) => ({ ...ev, stock: 'N' + i })),
    { ...ev, stock: 'U', condition: 'used', mileage: 5494 },
    { ...ev, stock: 'W', model: 'bZ Woodland' },
    { ...ev, stock: 'H', model: 'RAV4', fuel: 'Hybrid' },
  ];
  for (const model of ['bZ', 'bZ4X']) {
    const result = searchVehicles(vehicles, { model, condition: 'new and used', fuel_type: 'electric' });
    assert.equal(result.matches.length, 7);
    assert.ok(result.matches.every(v => v.model === 'bZ'));
  }
  assert.deepEqual(detectModels('bZ Woodland versus bZ'), ['bz woodland', 'bz']);
  assert.deepEqual(searchVehicles(vehicles, { model: 'bZ Woodland' }).matches.map(v => v.stock), ['W']);
  assert.equal(searchVehicles(vehicles, { fuel_type: 'electric' }).matches.length, 8);
});

test('used-only mileage ceiling retains new listings and excludes unknown used mileage', () => {
  const vehicles = [...inv, { ...inv[2], stock: 'old', mileage: 40000 }, { ...inv[2], stock: 'unknown', mileage: null }];
  const r = searchVehicles(vehicles, { model: 'RAV4', condition: 'both', max_used_mileage: 30000 });
  assert.deepEqual(r.matches.map(v => v.stock), ['3', '2', '1']);
});
