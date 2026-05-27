import React, { lazy, Suspense } from 'react';
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

const AdminLogin = lazy(() => import('./screens/admin/AdminLogin'));
const Dashboard = lazy(() => import('./screens/admin/Dashboard'));
const Settings = lazy(() => import('./screens/admin/Settings'));
const MenuInventory = lazy(() => import('./screens/admin/MenuInventory'));
const ARStudio = lazy(() => import('./screens/admin/ARStudio'));
const QRFactory = lazy(() => import('./screens/admin/QRFactory'));
const KDS = lazy(() => import('./screens/admin/KDS'));
const OrderMonitor = lazy(() => import('./screens/admin/OrderMonitor'));
const GuestCRM = lazy(() => import('./screens/admin/GuestCRM'));
const Campaigns = lazy(() => import('./screens/admin/Campaigns'));
const BranchOverview = lazy(() => import('./screens/admin/BranchOverview'));

function RouteFallback() {
  return (
    <div className="min-h-dvh bg-background text-on-surface flex items-center justify-center">
      <span className="material-symbols-outlined text-primary text-4xl animate-spin">progress_activity</span>
    </div>
  );
}

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
                <Suspense fallback={<RouteFallback />}>
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
                      <Route path="/admin/guests"     element={<RequireAuth roles={['owner', 'manager']}><ErrorBoundary><GuestCRM /></ErrorBoundary></RequireAuth>} />
                      <Route path="/admin/campaigns"  element={<RequireAuth roles={['owner', 'manager']}><ErrorBoundary><Campaigns /></ErrorBoundary></RequireAuth>} />
                      <Route path="/admin/branches"   element={<RequireAuth roles={['owner']}><ErrorBoundary><BranchOverview /></ErrorBoundary></RequireAuth>} />
                    </>
                  )}

                  {/* ── Customer Routes ──────────────────────── */}
                  {(appType === 'user' || appType === 'all') && (
                    <>
                      {/* LF-3: Directory only accessible in dev mode; production redirects to menu */}
                      <Route path="/" element={isDev ? <Directory /> : <Navigate to="/menu" replace />} />
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
                </Suspense>
              </ErrorBoundary>
            </BrowserRouter>
          </AuthProvider>
        </ToastProvider>
      </CartProvider>
    </ThemeProvider>
  );
}
