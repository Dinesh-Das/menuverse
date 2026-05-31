import { loadEnv } from 'vite'
import process from 'node:process'

// Throws a build error if dangerous flags are enabled in production.
export function guardProductionFlags() {
  return {
    name: 'guard-production-flags',
    config(_config, { mode }) {
      if (mode !== 'production') return

      const env = loadEnv(mode, process.cwd(), '')
      const allowClientOrderFallback =
        process.env.VITE_ALLOW_CLIENT_ORDER_FALLBACK ?? env.VITE_ALLOW_CLIENT_ORDER_FALLBACK

      if (String(allowClientOrderFallback).toLowerCase() === 'true') {
        throw new Error(
          '[Menuverse] FATAL: VITE_ALLOW_CLIENT_ORDER_FALLBACK=true is set in a production build. ' +
          'This bypasses session security. Remove it before deploying.'
        )
      }
    },
  }
}
