import assert from 'node:assert/strict';
import process from 'node:process';
import { guardProductionFlags, isProductionBuild } from './guard-production-flags.js';

const previousNodeEnv = process.env.NODE_ENV;
const previousViteMode = process.env.VITE_MODE;
const previousFallback = process.env.VITE_ALLOW_CLIENT_ORDER_FALLBACK;

try {
  delete process.env.NODE_ENV;
  delete process.env.VITE_MODE;
  process.env.VITE_ALLOW_CLIENT_ORDER_FALLBACK = 'true';

  assert.equal(isProductionBuild({ command: 'build', mode: 'production' }), true);
  assert.throws(
    () => guardProductionFlags().config({}, { command: 'build', mode: 'production' }),
    /FATAL: VITE_ALLOW_CLIENT_ORDER_FALLBACK=true/,
  );
  assert.doesNotThrow(
    () => guardProductionFlags().config({}, { command: 'serve', mode: 'development' }),
  );
} finally {
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  if (previousViteMode === undefined) delete process.env.VITE_MODE;
  else process.env.VITE_MODE = previousViteMode;
  if (previousFallback === undefined) delete process.env.VITE_ALLOW_CLIENT_ORDER_FALLBACK;
  else process.env.VITE_ALLOW_CLIENT_ORDER_FALLBACK = previousFallback;
}

console.log('guard-production-flags.test.js: all assertions passed');
