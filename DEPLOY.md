# Menuverse — Deployment Guide

> Last updated: May 2026 · Architecture: Supabase-native (no Express required in production)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│  Customer Browser / Kitchen Display              │
│  React 18 + Vite SPA  (Vercel / Netlify)         │
└───────────────────┬─────────────────────────────┘
                    │ HTTPS / Supabase JS client
         ┌──────────▼──────────────┐
         │     Supabase Cloud       │
         │  ┌─────────────────────┐ │
         │  │   PostgreSQL + RLS  │ │  ← Row Level Security enforced
         │  │   Realtime          │ │  ← WebSocket (order:new, order:updated)
         │  │   Auth              │ │  ← Supabase Auth (email/password)
         │  │   Storage           │ │  ← restaurant-assets bucket (logos)
         │  └─────────────────────┘ │
         └─────────────────────────┘

  Express server/index.js  ← DEPRECATED — used only for local dev seed scripts.
                              Not deployed to production.
```

---

## Pre-Deployment Checklist

### 1. Environment Variables

Set these in your Vercel / Netlify project settings:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...           # Supabase anon public key (safe to expose)
VITE_APP_TYPE=all                       # 'admin', 'user', or 'all'
```

> **NEVER** commit `.env` with real keys. `.env` is in `.gitignore`.

---

### 2. Supabase Project Setup

#### 2a. Run RLS Policies

Execute `supabase/rls-policies.sql` in **Supabase Dashboard → SQL Editor → New Query**.
This enables Row Level Security on all tables.

#### 2b. Run Schema Unique Constraints

Run the following to enforce data integrity:

```sql
ALTER TABLE "Table"
  ADD CONSTRAINT "Table_restaurant_id_number_key" UNIQUE (restaurant_id, number);

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_order_id_key" UNIQUE (order_id);
```

#### 2c. Create Storage Bucket for Logo Uploads

In **Supabase Dashboard → Storage → New Bucket**:
- Bucket name: `restaurant-assets`
- Public: ✅ Yes (logo URLs must be publicly readable for the menu display)
- File size limit: 5MB
- Allowed MIME types: `image/png, image/svg+xml, image/jpeg, image/webp`

Then add a storage policy in **Storage → Policies** (or run in SQL Editor):

```sql
-- Allow authenticated restaurant owners to upload to their own folder
CREATE POLICY "owner_upload_logo"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'restaurant-assets'
  AND auth.role() = 'authenticated'
  AND (storage.foldername(name))[1] = 'logos'
);

-- Allow public read for all logos
CREATE POLICY "public_read_logo"
ON storage.objects FOR SELECT
USING (bucket_id = 'restaurant-assets');
```

---

### 3. Prisma Schema Sync (if using Express server locally)

The Express server with Prisma is used **only for local development seeding**. In production, the frontend talks directly to Supabase.

If you need to sync the schema to a dev DB:

```bash
npx prisma db push        # Push schema to dev Supabase (uses DATABASE_URL)
npx prisma studio         # Browse data in browser
```

Required `.env` for server:
```env
DATABASE_URL=postgresql://postgres:[password]@db.your-project.supabase.co:5432/postgres
DIRECT_URL=postgresql://postgres:[password]@db.your-project.supabase.co:5432/postgres
JWT_SECRET=<at-least-32-char-high-entropy-string>
```

---

### 4. Staff Account Management

Supabase Auth invite requires the **service role key** (server-side only — never expose to clients).

To invite staff from the command line or a backend script:

```bash
curl -X POST 'https://your-project.supabase.co/auth/v1/admin/users' \
  -H "apikey: YOUR_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "staff@restaurant.com",
    "password": "temporary-password",
    "email_confirm": true,
    "user_metadata": { "restaurant_id": "YOUR_RESTAURANT_UUID", "role": "staff" }
  }'
```

After creating the auth user, also insert the User table record:

```sql
INSERT INTO "User" (id, restaurant_id, email, role, password_hash)
VALUES (
  'SUPABASE_AUTH_USER_UUID',
  'YOUR_RESTAURANT_UUID',
  'staff@restaurant.com',
  'staff',
  'managed-by-supabase-auth'
);
```

---

### 5. Vercel Deployment

```bash
npm run build       # Verify build locally first
vercel --prod       # Deploy to production
```

Ensure `vercel.json` has SPA fallback configured:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/" }]
}
```

---

### 6. First Restaurant Setup

After deploying, create the first restaurant record directly in Supabase:

1. **Dashboard → Table Editor → Restaurant** → Insert a row
2. Copy the generated UUID — this is your `restaurant_id`
3. Create an owner user in Supabase Auth, then insert into `User` table with `role = 'owner'` and the restaurant UUID

Then visit: `https://your-app.vercel.app/admin/login`

---

### 7. QR Code Generation

Use the **Admin → QR Factory** screen to generate QR codes for each table. Each QR code encodes:
```
https://your-app.vercel.app/r/{restaurant-slug}/t/{table-uuid}
```

---

## Known Limitations & Pending Work

| Item | Status |
|---|---|
| Razorpay payment integration | ⚠️ Simulated — replace `simulatePayment()` in `TableSession.jsx` with real Razorpay Checkout |
| Password recovery email flow | ⚠️ Needs Supabase Auth email template configuration |
| Offline support | ⚠️ No service worker — requires PWA setup for true offline kitchen display resilience |
| GST invoice generation | ❌ Not implemented — consider Supabase Edge Function + PDF generation |
