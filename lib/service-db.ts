import { createClient } from "@supabase/supabase-js";
export function serviceDB() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw Error("Server database configuration required");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
