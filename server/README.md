# Legacy Express Backend

This folder is deprecated for the current Menuverse MVP.

The active application is the Vite frontend in `src/` using Supabase Auth, RLS, RPC functions, Realtime, and Edge Functions. Do not deploy `server/index.js` for production QR ordering unless a future migration explicitly reintroduces a backend service.

Legacy public order reads require a valid `table_session_token`; do not remove that guard if this server is reused.
