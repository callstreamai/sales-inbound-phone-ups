import test from 'node:test';
import assert from 'node:assert/strict';
import { unitMaterialAnswer } from '../src/inventory/vehicleAnswer.js';
const facts = { selected_slot: 0, units: [
  { slot: 1, stock: 'NEW1', condition: 'new', color: 'Black', interior: 'Black SofTex/Fabric Mixed Media Trim' },
  { slot: 2, stock: 'USED1', condition: 'used', color: 'Supersonic Red', interior: 'Black', features: 'Leather wrapped steering wheel' },
] };
test('unknown used upholstery never borrows new-unit SofTex or steering-wheel leather', () => {
  const result = unitMaterialAnswer('Does the used red one have genuine leather?', facts);
  assert.match(result.helper_answer, /does not specify/);
  assert.doesNotMatch(result.helper_answer, /SofTex|describes leather seating/);
});
test('known new upholstery and ambiguous unit are handled without guessing', () => {
  assert.match(unitMaterialAnswer('Does NEW1 have leather?', facts).helper_answer, /synthetic/);
  assert.equal(unitMaterialAnswer('Does this one have leather?', facts).status, 'clarify_unit');
  assert.equal(unitMaterialAnswer('What is the difference between bZ and Woodland?', facts), null);
});
