import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';

export default function AdminLogin() {
  // const [email, setEmail] = useState('');
  // const [password, setPassword] = useState('');
  const [email, setEmail] = useState('admin@zaikazindagi.com');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isDark, toggleTheme } = useTheme();
  const isExpired = searchParams.get('expired') === 'true';

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(email, password);
      navigate('/admin/dashboard');
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-on-surface overflow-hidden relative selection:bg-primary-container/30">
      {/* ── Ambient Gradient Orbs ──────────────────────────── */}
      <div className="ambient-orb-gold"></div>
      <div className="ambient-orb-blue"></div>
      <div className="absolute inset-0 bg-background/60 backdrop-blur-[100px] pointer-events-none z-0"></div>

      {/* Theme Toggle */}
      <button
        aria-label="Toggle Theme"
        onClick={toggleTheme}
        className="absolute top-6 right-6 z-50 cursor-pointer flex items-center justify-center p-2 rounded-full glass-dark border border-outline-variant/20 hover:bg-surface-container transition-colors"
      >
        <span className="material-symbols-outlined text-on-surface">
          {isDark ? 'light_mode' : 'dark_mode'}
        </span>
      </button>

      {/* ── 12-Column Grid Layout ──────────────────────────── */}
      <div className="relative z-10 w-full min-h-screen flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-7xl grid grid-cols-12 gap-8 md:gap-16">

          {/* Left Side: Brand Story & Imagery (Hidden on small screens) */}
          <div className="hidden lg:flex lg:col-span-7 flex-col justify-between">
            <div>
              <h1 className="font-headline text-6xl font-bold tracking-tighter mb-4 text-on-surface drop-shadow-2xl">
                Zaika Zindagi
              </h1>
              <p className="text-[12px] uppercase font-bold tracking-[0.4em] text-primary">
                Kitchen Command Portal
              </p>
            </div>

            <div className="relative mt-12 w-full max-w-md h-96 rounded-2xl overflow-hidden border border-outline-variant/10 shadow-luxury-dark group">
              <img
                src="/images/interior.png"
                alt="Restaurant Interior"
                className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110 contrast-[1.1] brightness-75"
              />
              {/* Glass Overlay Card */}
              <div className="absolute bottom-6 left-6 right-6 p-5 bg-black/40 backdrop-blur-xl rounded-xl border border-white/10 flex items-center gap-4">
                <div className="w-12 h-12 rounded-full border border-primary/40 flex items-center justify-center bg-primary/10">
                  <span className="material-symbols-outlined text-primary text-xl animate-pulse">fingerprint</span>
                </div>
                <div>
                  <p className="font-bold text-sm text-white">Biometric Access Active</p>
                  <p className="text-[10px] text-white/50 uppercase tracking-[0.2em] mt-1">Terminal 42 Secured</p>
                </div>
              </div>
            </div>

            <div className="mt-12 text-on-surface-variant font-body text-sm max-w-md leading-relaxed">
              Orchestrate the digital dining experience. Manage AR menus, monitor KDS throughput, and analyze table-turn metrics in real time.
            </div>
          </div>

          {/* Right Side: Login Form Card */}
          <div className="col-span-12 lg:col-span-5 flex flex-col justify-center">
            {/* Mobile Header (Hidden on large screens) */}
            <div className="lg:hidden mb-10 text-center">
              <h1 className="font-headline text-4xl font-bold tracking-tight mb-3 text-on-surface">Zaika Zindagi</h1>
              <p className="text-[10px] uppercase font-bold tracking-[0.2em] text-primary">Kitchen Command Portal</p>
            </div>

            <div className="bg-surface-container-low/60 backdrop-blur-md p-8 md:p-12 rounded-3xl border border-outline-variant/15 shadow-luxury-dark">
              <div className="mb-10">
                <h2 className="text-2xl font-bold text-on-surface mb-2 font-headline">Authentication</h2>
                <p className="text-on-surface-variant text-sm">Enter your credentials to access the command center.</p>
                {isExpired && !error && (
                  <p className="text-amber-500 mt-4 text-xs font-bold bg-amber-500/10 p-2 rounded border border-amber-500/20 flex items-center gap-2">
                    <span className="material-symbols-outlined text-sm">info</span>
                    Session expired. Please log in again.
                  </p>
                )}
                {error && <p className="text-error mt-4 text-xs font-bold bg-error/10 p-2 rounded">{error}</p>}
              </div>

              <form onSubmit={handleLogin} className="space-y-8">
                {/* Email Input */}
                <div className="relative input-line-focus">
                  <label className="text-[10px] uppercase font-bold tracking-[0.15em] text-on-surface-variant mb-2 block">
                    Email Address
                  </label>
                  <div className="flex items-center border-b border-outline-variant/30 pb-2 relative">
                    <span className="material-symbols-outlined text-on-surface-variant mr-3 text-xl">mail</span>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-transparent text-on-surface font-medium focus:outline-none placeholder-on-surface-variant/40"
                      placeholder="admin@restaurant.com"
                    />
                  </div>
                  <div className="focus-bar"></div>
                </div>

                {/* Password Input */}
                <div className="relative input-line-focus">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-[10px] uppercase font-bold tracking-[0.15em] text-on-surface-variant">
                      Password
                    </label>
                    <a href="#" className="text-[10px] text-primary hover:text-primary-fixed transition-colors font-bold tracking-wider">
                      RECOVERY?
                    </a>
                  </div>
                  <div className="flex items-center border-b border-outline-variant/30 pb-2 relative">
                    <span className="material-symbols-outlined text-on-surface-variant mr-3 text-xl">key</span>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-transparent text-on-surface font-medium focus:outline-none placeholder-on-surface-variant/40 tracking-widest"
                      placeholder="••••••••"
                    />
                  </div>
                  <div className="focus-bar"></div>
                </div>

                {/* Login Button */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-6 bg-primary-container text-on-primary-container hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed py-4 rounded-xl font-bold uppercase tracking-widest text-sm shadow-luxury transition-all active:scale-95 cursor-pointer flex justify-center items-center gap-3 group"
                >
                  {loading ? 'Authorizing...' : 'Authorize Access'}
                  <span className="material-symbols-outlined text-lg transition-transform group-hover:translate-x-1">arrow_forward</span>
                </button>
              </form>

              {/* Alternative Auth */}
              <div className="mt-10">
                <div className="relative flex items-center py-5">
                  <div className="flex-grow border-t border-outline-variant/20"></div>
                  <span className="flex-shrink-0 mx-4 text-on-surface-variant/60 text-[10px] uppercase tracking-widest font-bold">Or Connect With</span>
                  <div className="flex-grow border-t border-outline-variant/20"></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <button className="py-3 rounded-lg border border-outline-variant/20 hover:bg-surface-container/50 text-on-surface text-xs font-bold transition-colors flex justify-center items-center gap-2 cursor-pointer">
                    <span className="material-symbols-outlined text-sm">fingerprint</span>
                    Biometric
                  </button>
                  <button className="py-3 rounded-lg border border-outline-variant/20 hover:bg-surface-container/50 text-on-surface text-xs font-bold transition-colors flex justify-center items-center gap-2 cursor-pointer">
                    <span className="material-symbols-outlined text-sm">shield_person</span>
                    SSO
                  </button>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-12 flex justify-between items-center text-on-surface-variant/40 text-[9px] uppercase tracking-widest font-bold">
              <span>© 2026 Zaika Zindagi</span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
                v4.2.0 • Secure
              </span>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
