# Menuverse

QR-based restaurant ordering for table service, kitchen display (KDS), and restaurant operations — built as a Supabase-native web app.

## What’s in this repo

- `src/`: React 18 + Vite single-page app
- `supabase/`: SQL migrations, RLS policies, Edge Functions
- `server/`: supporting utilities (not the primary production data path)
- `docs/`: additional notes and references

## Architecture (current)

Menuverse is a React 18 + Vite SPA backed by Supabase:

- Auth: Supabase Auth (owner/manager/staff)
- Data: Postgres + Row Level Security (restaurant-scoped access)
- Trusted writes: Supabase RPC functions + Edge Functions
- Realtime: Supabase Realtime via `src/lib/socket.js` (socket-like wrapper for existing screens)
- Recommendations/insights: sentiment + ranking fields on menu/feedback (optional LLM integration)

The Supabase JS client is the primary data access layer. Anything that needs a trust boundary should go through RPC or an Edge Function.

## Quickstart (local)

Prereqs: Node.js 18+ and a Supabase project.

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`.

### Required env (client)

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
VITE_APP_TYPE=all
```

Optional for local demos only:

- `VITE_ALLOW_CLIENT_ORDER_FALLBACK=true` (do not enable in production)

## Supabase setup

1) Run SQL migrations in `supabase/migrations/` (in order) against your Supabase project.
2) Apply `supabase/rls-policies.sql`.

### Key RPC functions (production path)

- `start_table_session`
- `create_order_secure`
- `get_order_status_secure`
- `get_table_session_orders`
- `create_staff_request_secure`
- `submit_order_feedback_secure`
- `close_table_session`
- `remove_staff_member_secure`

### Edge Functions

Deploy only what you need for your environment:

```bash
supabase functions deploy analyse-feedback
supabase functions deploy create-payment-order
supabase functions deploy invite-staff
supabase functions deploy get-recommendations
```

For the full list of functions, and production secrets/CORS guidance, see `DEPLOY.md`.

## Scripts

```bash
npm run lint
npm run test:unit
npm run test:all
npm run build
npm run preview
```

## Production notes (read before going live)

- Apply migrations + RLS before enabling public QR ordering.
- Verify every owner/manager/staff user has `User.restaurant_id` set correctly.
- Prefer session-specific table links/tokens for occupied tables; static table QR scans should not expose an active bill unless explicitly enabled.
- Keep service role keys, payment secrets, and webhook secrets only in Edge Function secrets.
- Set `APP_ORIGIN` / `ALLOWED_ORIGINS` for Edge Function CORS before production deploys.
- Keep `VITE_ALLOW_CLIENT_ORDER_FALLBACK` unset in production.

## More docs

- Local run guide: `APP_RUN.md`
- Deployment: `DEPLOY.md`
- Security: `SECURITY.md`
