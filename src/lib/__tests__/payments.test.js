import assert from 'node:assert/strict';
import { getWalletPaymentLabel, humanizePaymentFailure } from '../payments.js';

Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)' },
  configurable: true,
});
const iosLabel = getWalletPaymentLabel(null, 'razorpay');
assert(!iosLabel.headline.includes('Apple Pay'), 'Razorpay should not promise native Apple Pay');

Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'Mozilla/5.0 (Linux; Android 13)' },
  configurable: true,
});
const androidLabel = getWalletPaymentLabel(null, 'razorpay');
assert(!androidLabel.headline.includes('Google Pay'), 'Razorpay should not promise a native Google Pay sheet');

const stripeLabel = getWalletPaymentLabel(null, 'stripe');
assert(stripeLabel.detail.includes('Apple Pay'), 'Stripe should advertise supported native wallets');

const declined = humanizePaymentFailure({ code: 'card_declined' }, 'Stripe');
assert(declined.includes('declined'), 'Declined cards should get a clear message');

console.log('payments.test.js: all assertions passed');
