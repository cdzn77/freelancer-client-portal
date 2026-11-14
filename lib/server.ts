import { createClient } from "@supabase/supabase-js";
export async function requestClient(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) throw Error("Sign in to continue.");
  const client = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    },
  );
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user)
    throw Error("Your session has expired. Sign in again.");
  const security = await client.rpc("pms_security_status");
  if (
    security.error ||
    !security.data ||
    security.data.password_required ||
    security.data.mfa_required
  )
    throw Error(
      "Complete your password change or two-factor verification first.",
    );
  return client;
}
