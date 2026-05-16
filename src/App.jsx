import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { CartProvider } from './context/CartContext';
import { ToastProvider } from './components/Toast';
import { AuthProvider } from './context/AuthContext';
import RequireAuth from './components/RequireAuth';
import ErrorBoundary from './components/ErrorBoundary';

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
  const appType = import.meta.env.VITE_APP_TYPE || 'all'; // 'admin', 'user', or 'all'
  const isDev = import.meta.env.DEV;

  return (
    <ThemeProvider>
      <CartProvider>
        <ToastProvider>
          <AuthProvider>
            <BrowserRouter>
              <ErrorBoundary>
                <Routes>
                  {/* ── Admin Routes ─────────────────────────── */}
                  {(appType === 'admin' || appType === 'all') && (
                    <>
                      <Route path="/admin"            element={<Navigate to="/admin/login" replace />} />
                      <Route path="/admin/login"      element={<AdminLogin />} />
                      <Route path="/admin/dashboard"  element={<RequireAuth roles={['owner', 'manager']}><ErrorBoundary><Dashboard /></ErrorBoundary></RequireAuth>} />
                      <Route path="/admin/settings"   element={<RequireAuth roles={['owner']}><ErrorBoundary><Settings /></ErrorBoundary></RequireAuth>} />
                      <Route path="/admin/menu"       element={<RequireAuth roles={['owner', 'manager']}><ErrorBoundary><MenuInventory /></ErrorBoundary></RequireAuth>} />
                      <Route path="/admin/ar"         element={<RequireAuth roles={['owner', 'manager']}><ErrorBoundary><ARStudio /></ErrorBoundary></RequireAuth>} />
                      <Route path="/admin/qr"         element={<RequireAuth roles={['owner', 'manager']}><ErrorBoundary><QRFactory /></ErrorBoundary></RequireAuth>} />
                      <Route path="/admin/kds"        element={<RequireAuth roles={['owner', 'manager', 'staff']}><ErrorBoundary><KDS /></ErrorBoundary></RequireAuth>} />
                      <Route path="/admin/orders"     element={<RequireAuth roles={['owner', 'manager']}><ErrorBoundary><OrderMonitor /></ErrorBoundary></RequireAuth>} />
                    </>
                  )}

                  {/* ── Customer Routes ──────────────────────── */}
                  {(appType === 'user' || appType === 'all') && (
                    <>
                      {/* LF-3: Directory only accessible in dev mode; production redirects to menu */}
                      <Route path="/" element={isDev ? <Directory /> : <Navigate to="/r/zaika-zindagi/menu" replace />} />
                      <Route path="/r/:restaurantSlug/t/:tableId"    element={<QRLanding />} />
                      <Route path="/r/:restaurantSlug/menu"          element={<MenuHome />} />
                      <Route path="/r/:restaurantSlug/dish/:dishId"  element={<DishDetail />} />
                      <Route path="/r/:restaurantSlug/checkout"      element={<Checkout />} />
                      <Route path="/r/:restaurantSlug/order/:orderId" element={<OrderStatus />} />
                      <Route path="/r/:restaurantSlug/table"          element={<TableSession />} />

                      {/* Legacy routes */}
                      <Route path="/t/:tableId"       element={<Navigate to="/" replace />} />
                      <Route path="/menu"             element={<MenuHome />} />
                      <Route path="/dish/:dishId"     element={<DishDetail />} />
                      <Route path="/checkout"         element={<Checkout />} />
                      <Route path="/order/:orderId"   element={<OrderStatus />} />
                      <Route path="/order"            element={<TableSession />} />
                    </>
                  )}

                  {/* ── Redirects ────────────────────────────── */}
                  {appType === 'admin' && <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />}
                  {appType === 'user' && <Route path="*" element={<Navigate to="/" replace />} />}
                  {appType === 'all' && <Route path="*" element={<Navigate to="/" replace />} />}
                </Routes>
              </ErrorBoundary>
            </BrowserRouter>
          </AuthProvider>
        </ToastProvider>
      </CartProvider>
    </ThemeProvider>
  );
}
