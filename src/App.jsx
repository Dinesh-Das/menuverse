import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { CartProvider } from './context/CartContext';
import { ToastProvider } from './components/Toast';
import { AuthProvider } from './context/AuthContext';
import RequireAuth from './components/RequireAuth';

// Customer screens
import QRLanding     from './screens/QRLanding';
import MenuHome      from './screens/MenuHome';
import DishDetail    from './screens/DishDetail';
import Checkout      from './screens/Checkout';
import OrderStatus   from './screens/OrderStatus';
import TableSession from './screens/TableSession';
import Directory     from './screens/Directory';

// Admin screens
import AdminLogin    from './screens/admin/AdminLogin';
import Dashboard     from './screens/admin/Dashboard';
import Settings      from './screens/admin/Settings';
import MenuInventory from './screens/admin/MenuInventory';
import ARStudio      from './screens/admin/ARStudio';
import QRFactory     from './screens/admin/QRFactory';
import KDS           from './screens/admin/KDS';
import OrderMonitor  from './screens/admin/OrderMonitor';

export default function App() {
  return (
    <ThemeProvider>
      <CartProvider>
        <ToastProvider>
          <AuthProvider>
            <BrowserRouter>
              <Routes>
                {/* ── Root Directory ─────────────────────────── */}
                <Route path="/" element={<Directory />} />

                {/* ── Customer PWA (QR format) ───────────────── */}
                <Route path="/r/:restaurantSlug/t/:tableId"    element={<QRLanding />} />
                <Route path="/r/:restaurantSlug/menu"          element={<MenuHome />} />
                <Route path="/r/:restaurantSlug/dish/:dishId"  element={<DishDetail />} />
                <Route path="/r/:restaurantSlug/checkout"      element={<Checkout />} />
                <Route path="/r/:restaurantSlug/order/:orderId" element={<OrderStatus />} />
                <Route path="/r/:restaurantSlug/table"          element={<TableSession />} />

                {/* ── Legacy routes ─────────────────────────── */}
                <Route path="/t/:tableId"       element={<Navigate to="/" replace />} />
                <Route path="/menu"             element={<MenuHome />} />
                <Route path="/dish/:dishId"     element={<DishDetail />} />
                <Route path="/checkout"         element={<Checkout />} />
                <Route path="/order/:orderId"   element={<OrderStatus />} />
                <Route path="/order"            element={<TableSession />} />

                {/* ── Admin ─────────────────────────────────── */}
                <Route path="/admin"            element={<Navigate to="/admin/login" replace />} />
                <Route path="/admin/login"      element={<AdminLogin />} />
                <Route path="/admin/dashboard"  element={<RequireAuth roles={['owner', 'manager']}><Dashboard /></RequireAuth>} />
                <Route path="/admin/settings"   element={<RequireAuth roles={['owner']}><Settings /></RequireAuth>} />
                <Route path="/admin/menu"       element={<RequireAuth roles={['owner', 'manager']}><MenuInventory /></RequireAuth>} />
                <Route path="/admin/ar"         element={<RequireAuth roles={['owner', 'manager']}><ARStudio /></RequireAuth>} />
                <Route path="/admin/qr"         element={<RequireAuth roles={['owner', 'manager']}><QRFactory /></RequireAuth>} />
                <Route path="/admin/kds"        element={<RequireAuth roles={['owner', 'manager', 'staff']}><KDS /></RequireAuth>} />
                <Route path="/admin/orders"     element={<RequireAuth roles={['owner', 'manager']}><OrderMonitor /></RequireAuth>} />

                {/* ── 404 fallback ──────────────────────────── */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </BrowserRouter>
          </AuthProvider>
        </ToastProvider>
      </CartProvider>
    </ThemeProvider>
  );
}
