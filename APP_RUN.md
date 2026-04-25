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
   DATABASE_URL="file:./dev.db"
   JWT_SECRET="zaikazindagi-super-secret-key"
   BASE_URL="http://localhost:5173"
   PORT=3005
   ```

4. **Initialize Database**:
   The app uses Prisma with SQLite for local development. Run the following command to sync your database schema:
   ```bash
   npx prisma db push
   ```

## Running the Application

You can start both the backend server and the frontend development server simultaneously using a single command:

```bash
npm run dev
```

This command runs:
- **Frontend (Vite)**: `http://localhost:5173`
- **Backend (Express)**: `http://localhost:3005`

### Seeding Initial Data
On the first run, the database will be empty. You can seed the database with a sample restaurant, menu items, and admin user by visiting:
`http://localhost:3005/api/seed` (POST request) or simply opening the app; the landing page is designed to trigger this if no data is found.

## Admin Access

To access the administrative dashboard (KDS, Menu Management, etc.):
- **URL**: `http://localhost:5173/admin/login`
- **Default Credentials**:
  - **Email**: `admin@zaikazindagi.com`
  - **Password**: `password123`

## Troubleshooting

### Port Conflict (`EADDRINUSE`)
If you see an error like `Error: listen EADDRINUSE: address already in use :::3005`, it means another process is already using port 3005.
- **Solution**: Kill the process running on port 3005 or change the `PORT` variable in your `.env` file.
- **To kill the process on Windows**:
  ```powershell
  Stop-Process -Id (Get-NetTCPConnection -LocalPort 3005).OwningProcess -Force
  ```

### Database Issues
If the app fails to fetch data, try resetting the Prisma client:
```bash
npx prisma generate
```

## Key Modules
- `/r/:restaurantSlug/t/:tableId` - Customer Menu Landing (via QR)
- `/admin/dashboard` - Admin Analytics
- `/admin/kds` - Kitchen Display System (Real-time)
- `/admin/orders` - Live Order Monitor



http://localhost:5173/r/zaika-zindagi/t/368183c9-b072-4add-9d1d-8d6066959062