import assert from 'node:assert/strict';
import { getWalletPaymentLabel, humanizePaymentFailure } from '../payments.js';

Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)' },
  configurable: true,
});
const iosLabel = getWalletPaymentLabel();
assert(iosLabel.headline.includes('Apple Pay'), 'iOS should mention Apple Pay');

Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'Mozilla/5.0 (Linux; Android 13)' },
  configurable: true,
});
const androidLabel = getWalletPaymentLabel();
assert(androidLabel.headline.includes('Google Pay'), 'Android should mention Google Pay');

const declined = humanizePaymentFailure({ code: 'card_declined' }, 'Stripe');
assert(declined.includes('declined'), 'Declined cards should get a clear message');

console.log('payments.test.js: all assertions passed');
