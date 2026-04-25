# Menuverse — Zaika Zindagi
### Premium Digital Dining & Kitchen Orchestration System

Zaika Zindagi is a high-fidelity, QR-based Progressive Web Application (PWA) and Administrative Suite designed for premium Indian culinary establishments. It reimagines the dining experience through a "Gourmet Tech Editorial" design lens, blending immersive visual storytelling with industrial-grade kitchen management.

---

## 🌟 Key Experiences

### 1. Customer PWA (The Digital Menu)
*   **Immersive Editorial UI**: A high-end landing page and menu experience that feels like a luxury food magazine.
*   **Dynamic Cart System**: Seamless addition of gourmet dishes with real-time modifier selection (e.g., Spice Levels).
*   **Table-Aware Ordering**: Integrated QR-linkage that automatically routes orders to specific tables (Main Hall, Terrace, Bar).
*   **Live Order Tracking**: Real-time status updates from the kitchen via WebSocket integration.

### 2. Kitchen Command Portal (Admin Suite)
*   **KDS (Kitchen Display System)**: A high-throughput interface for chefs to manage order states (Accepted → Preparing → Ready → Served).
*   **Order Monitor**: A centralized dashboard for floor managers to track all active table sessions and revenue.
*   **Menu & Inventory Control**: Real-time management of dish availability, pricing, and premium imagery.
*   **AR Menu Studio**: (In-Development) Advanced 3D/AR previewing of signature dishes.

---

## 🛠 Tech Stack

### Frontend
*   **React 18 + Vite**: Lightning-fast UI with modern component architecture.
*   **Tailwind CSS**: Custom "Gourmet Tech" design system with glassmorphism, editorial typography, and ambient lighting.
*   **Socket.io Client**: Real-time bidirectional communication for order updates.
*   **Framer Motion**: Smooth, cinematic transitions and micro-animations.

### Backend
*   **Node.js & Express**: Robust RESTful API architecture.
*   **Prisma ORM**: Type-safe database access and schema management.
*   **Socket.io**: Real-time event broadcasting to KDS and Customer PWAs.
*   **JWT Authentication**: Secure, role-based access control for administrative staff.

### Database
*   **SQLite**: Lightweight, file-based relational storage for local deployment and rapid prototyping.

---

## 🚀 Getting Started

### 1. Prerequisites
*   Node.js (v18+)
*   npm or yarn

### 2. Installation
```bash
# Clone the repository
git clone <repository-url>

# Install dependencies
npm install
```

### 3. Database Setup
```bash
# Initialize Prisma and generate client
npx prisma generate
npx prisma db push

# Seed the database with premium dishes and admin user
node scratch/seed_admin.cjs
```

### 4. Running the Project
```bash
# Start both Frontend and Backend concurrently
npm run dev
```
*   **Frontend**: `http://localhost:5173`
*   **Backend**: `http://localhost:3001`

---

## 📁 Project Structure

```text
├── server/             # Express server and WebSocket logic
├── prisma/             # Database schema and migrations
├── src/
│   ├── components/     # Reusable UI components (TopNav, BottomNav, etc.)
│   ├── context/        # Global state (Auth, Cart, Theme)
│   ├── screens/        # Primary page components
│   │   ├── admin/      # Administrative & KDS screens
│   │   └── customer/   # PWA & Menu screens
│   └── lib/            # Shared utilities (API, Socket config)
├── public/
│   └── images/         # Premium dish and brand assets
└── scratch/            # Utility scripts (Seeding, DB maintenance)
```

---

## 🎨 Design Philosophy
Zaika Zindagi adheres to the **Gourmet Tech Editorial** standard:
*   **Typography**: Mix of high-contrast Serif (Headline) and clean Sans-Serif (Body).
*   **Color Palette**: Deep matte blacks, creamy surfaces (#FAF9F6), and Royal Saffron gold (#B8860B).
*   **Interactions**: Intentional, low-latency micro-interactions that emphasize quality and precision.

---

## 🔐 Admin Credentials
*   **Email**: `admin@zaikazindagi.com`
*   **Password**: `password123`

---

© 2026 Zaika Zindagi. Reimagining the rich heritage of Indian royal cuisines.
