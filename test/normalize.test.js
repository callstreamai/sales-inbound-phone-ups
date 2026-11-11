import test from 'node:test';
import assert from 'node:assert/strict';
import { extractVehicles } from '../src/inventory/normalize.js';

const dealeron = { DisplayCards: [
  { VehicleCard: { VehicleVin: '2T3RWRFV5PW123456', VehicleYear: 2026, VehicleMake: 'Toyota', VehicleModel: 'RAV4', VehicleTrim: 'XLE', VehicleStockNumber: 'T26123', ExteriorColor: 'Blizzard Pearl', VehicleBodyStyle: 'SUV', FuelType: 'Hybrid', VehicleCondition: 'New', InTransit: false, VdpUrl: '/new-toyota-rav4-xle-2t3rwrfv5pw123456' },
    VehiclePricingInfo: { Msrp: 36495, InternetPrice: '$35,995', Payments: { Monthly: 499 } } },
  { VehicleCard: { VehicleVin: 'JTDBCMFE0N3012345', VehicleYear: 2022, VehicleMake: 'Toyota', VehicleModel: 'Corolla', VehicleTrim: 'LE', VehicleStockNumber: 'U8811', ExteriorColor: 'Black', Odometer: '18,204', VehicleCondition: 'Certified Used', VdpUrl: '/used-2022-toyota-corolla' },
    VehiclePricingInfo: { Msrp: null, RetailPrice: 21998 } },
], Paging: { TotalCount: 2 } };

const dealercom = { pageInfo: { totalCount: 1 }, inventory: [
  { vin: '3TYLB5JN0ST000111', year: '2025', make: 'Toyota', model: 'Tacoma', trim: 'TRD Off-Road', stockNumber: 'P4471', exteriorColor: 'Bronze Oxide', odometer: '9,120', fuelType: 'Gasoline', condition: 'used', link: '/used/Toyota/2025-Toyota-Tacoma-abc.htm',
    pricing: { retailPrice: '$44,500', dprice: [{ label: 'Internet Price', value: '$43,750' }], savings: { value: '$750' } } },
] };

test('extracts DealerOn-shaped payload', () => {
  const v = extractVehicles(dealeron, { condition: 'new', baseUrl: 'https://www.example.com' });
  assert.equal(v.length, 2);
  const rav = v.find((x) => x.model === 'RAV4');
  assert.equal(rav.stock, 'T26123');
  assert.equal(rav.price, 35995); // internet price preferred over MSRP
  assert.equal(rav.price_type, 'listed');
  assert.equal(rav.condition, 'new');
  assert.equal(rav.url, 'https://www.example.com/new-toyota-rav4-xle-2t3rwrfv5pw123456');
  const cor = v.find((x) => x.model === 'Corolla');
  assert.equal(cor.condition, 'certified');
  assert.equal(cor.mileage, 18204);
  assert.equal(cor.price, 21998);
});

test('extracts Dealer.com-shaped payload', () => {
  const v = extractVehicles(dealercom, { condition: 'used' });
  assert.equal(v.length, 1);
  assert.equal(v[0].price, 43750);
  assert.equal(v[0].trim, 'TRD Off-Road');
  assert.equal(v[0].condition, 'used');
  assert.equal(v[0].mileage, 9120);
});

test('ignores objects without a real VIN', () => {
  assert.equal(extractVehicles({ vin: 'NOT-A-VIN', year: 2024, model: 'X' }).length, 0);
});

 test('preserves boolean availability and cleans dealer color disclosures', () => {
  const rows = extractVehicles({ VehicleVin: '5YFB4MDE0VP524031', VehicleYear: 2027, VehicleModel: 'Corolla', VehicleMake: 'Toyota', VehicleInTransit: true, VehicleInProduction: false, ExteriorColorLabel: 'Wind Chill Pearl <a href="x"><sup>17</sup></a>' });
  assert.equal(rows[0].in_transit, true);
  assert.equal(rows[0].in_production, false);
  assert.equal(rows[0].exterior_color, 'Wind Chill Pearl');
});

test('uses actual DealerOn advertised prices for all three budget RAV4s', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = JSON.parse(await readFile(new URL('./fixtures/balise-used-pricing.json', import.meta.url), 'utf8'));
  const vehicles = extractVehicles(raw, { condition: 'used' });
  const prices = Object.fromEntries(vehicles.map(v => [v.vin, v.price]));
  assert.deepEqual(prices, { JTMRFREV2HD207976: 21245, '2T3G1RFV1LC124511': 23670, JTMP1RFV7KD033754: 22670 });
  assert.ok(vehicles.every(v => v.price_type === 'listed'));
  const { searchVehicles } = await import('../src/inventory/search.js');
  assert.equal(searchVehicles(vehicles, { condition: 'used', model: 'RAV4', max_price: 25000 }).matches.length, 3);
});

test('does not treat original MSRP or invoice as a used selling price', () => {
  const base = { vin: 'JTMRFREV2HD207976', year: 2017, make: 'Toyota', model: 'RAV4', condition: 'used', msrp: 28903 };
  const lib = Buffer.from('MSRP:28903;Invoice Price:16570;reff_Flat Low Price:20825').toString('base64');
  const [used] = extractVehicles({ ...base, pricelib: lib });
  assert.equal(used.price, null);
  assert.equal(used.price_type, null);
  const [fresh] = extractVehicles({ ...base, condition: 'new' });
  assert.equal(fresh.price, 28903);
  assert.equal(fresh.price_type, 'msrp');
});


test('an unknown used selling price cannot count as a budget match', async () => {
  const { searchVehicles } = await import('../src/inventory/search.js');
  const rows = extractVehicles({ vin: 'JTMRFREV2HD207976', year: 2017, make: 'Toyota', model: 'RAV4', condition: 'used', msrp: 28903 });
  assert.equal(searchVehicles(rows, { condition: 'used', model: 'RAV4', max_price: 25000 }).matches.length, 0);
});
