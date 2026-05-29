import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchUserProfile(session.user);
      else setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        fetchUserProfile(session.user);
      } else {
        setUser(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchUserProfile = async (authUser) => {
    try {
      // Query by id — matches RLS policy (auth.uid()::text = id)
      // Fallback to email match if id lookup fails (handles legacy records)
      let { data, error } = await supabase
        .from('User')
        .select('*, restaurant:Restaurant(*)')
        .eq('id', authUser.id)
        .maybeSingle();

      // Fallback: try by email (for accounts where id wasn't synced)
      if ((error || !data) && authUser.email) {
        const fallback = await supabase
          .from('User')
          .select('*, restaurant:Restaurant(*)')
          .eq('email', authUser.email)
          .maybeSingle();
        data = fallback.data;
        error = fallback.error;
      }

      if (!error && data) {
        setUser({
          id: data.id,
          email: data.email,
          role: data.role,
          restaurantId: data.restaurant_id,
          restaurant: data.restaurant,
        });
      } else {
        console.warn('[Auth] Profile not found for', authUser.email, '— role: unlinked');
        setUser({ id: authUser.id, email: authUser.email, role: 'unlinked' });
      }
    } catch (err) {
      console.error('[Auth] Error fetching user profile:', err);
      setUser({ id: authUser.id, email: authUser.email, role: 'unlinked' });
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return data;
  };

  const logout = async () => {
    await supabase.auth.signOut();
  };

  const refreshUserProfile = async () => {
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    if (!currentSession?.user) return null;
    setSession(currentSession);
    await fetchUserProfile(currentSession.user);
    return currentSession.user;
  };

  return (
    <AuthContext.Provider value={{ token: session?.access_token, user, login, logout, refreshUserProfile, loading }}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
