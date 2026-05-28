# Zaika Zindagi Application Setup & Execution Guide

This guide will walk you through the steps to get the Zaika Zindagi platform up and running locally.

## Prerequisites

Ensure you have the following installed on your machine:
- **Node.js** (v18 or higher recommended)
- **npm** (comes with Node.js)

## Initial Setup

1. **Clone the repository** (if you haven't already):
   ```bash
   git clone <repository-url>
   cd menu-verse
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Environment Configuration**:
   The project includes a `.env` file for local development. Ensure it contains the following:
   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-public-anon-key
   VITE_APP_TYPE=all
   VITE_CUSTOMER_APP_URL=http://localhost:5173
   ```

4. **Initialize Database**:
   Run the SQL migrations in `supabase/migrations/` against your Supabase project, then apply `supabase/rls-policies.sql`.

## Running the Application

Start the Vite development server:

```bash
npm run dev
```

This command runs:
- **Frontend (Vite)**: `http://localhost:5173`

### Seeding Initial Data
On the first run, the database will be empty. Use the migration seed data or Supabase SQL editor scripts maintained for your environment.

## Admin Access

To access the administrative dashboard (KDS, Menu Management, etc.):
- **URL**: `http://localhost:5173/admin/login`
- **Default Credentials**:
  - **Email**: `admin@zaikazindagi.com`
  - **Password**: `password123`

## Troubleshooting

### Database Issues
If the app fails to fetch data, verify `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, applied migrations, and RLS policies.

## Key Modules
- `/r/:restaurantSlug/t/:tableId` - Customer Menu Landing (via QR)
- `/admin/dashboard` - Admin Analytics
- `/admin/kds` - Kitchen Display System (Real-time)
- `/admin/orders` - Live Order Monitor



http://localhost:5173/r/zaika-zindagi/t/368183c9-b072-4add-9d1d-8d6066959062
