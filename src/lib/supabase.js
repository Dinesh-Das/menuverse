import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// SEC-06: Fail fast if env vars are missing — prevents silent broken client
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '[Menuverse] Missing Supabase configuration.\n' +
    'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.\n' +
    'See APP_RUN.md for setup instructions.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
