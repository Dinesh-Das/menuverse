import assert from 'node:assert/strict';
import {
  calculateOrderTotals,
  canTransitionOrderStatus,
  safeParseModifiers,
} from '../businessRules.js';

assert.deepEqual(safeParseModifiers('[{"name":"Extra spicy"}]'), [{ name: 'Extra spicy' }]);
assert.deepEqual(safeParseModifiers('{bad json'), []);
assert.equal(canTransitionOrderStatus('pending', 'accepted'), true);
assert.equal(canTransitionOrderStatus('ready', 'preparing'), false);

assert.deepEqual(
  calculateOrderTotals([
    { price: 100, quantity: 2, modifiers: [{ price_delta: 10 }] },
    { price: 50, qty: 1 },
  ], 0.05),
  { subtotal: 270, taxAmount: 13.5, totalAmount: 283.5 }
);

console.log('businessRules tests passed');
