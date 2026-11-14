import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

// Operator-only CLI. Never expose this operation through a public HTTP route.
export async function createFirstAdmin(env, factory = createClient) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.ANON_KEY;
  const email = (env.ADMIN_EMAIL || '').trim().toLowerCase();
  const name = (env.ADMIN_NAME || 'Studio owner').trim();
  const workspace = (env.ADMIN_WORKSPACE || 'My studio').trim();
  if (!url || !key || !anon) throw Error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))) throw Error('Use HTTPS except on localhost.');
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email)) throw Error('Set ADMIN_EMAIL to your email address.');
  if (!workspace || workspace.length > 120 || !name || name.length > 100) throw Error('Check ADMIN_NAME and ADMIN_WORKSPACE lengths.');
  const password = env.ADMIN_PASSWORD || randomBytes(24).toString('base64url') + '!aA9';
  if (password.length < 16) throw Error('ADMIN_PASSWORD must have at least 16 characters.');
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = factory(url, key, options);
  const owners = await admin.from('workspace_members').select('user_id', { count: 'exact', head: true }).eq('role', 'owner');
  if (owners.error) throw Error('Could not check administrators. Apply all database migrations first.');
  if (owners.count == null) throw Error('Could not verify administrator count.');
  if (owners.count > 0) throw Error('An administrator already exists. Use Workspace settings to invite accounts.');
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { pms_admin_provisioned: true }, user_metadata: { full_name: name, name } });
  if (created.error || !created.data?.user) throw Error(created.error?.message || 'Account creation failed.');
  const user = factory(url, anon, options);
  try {
    const login = await user.auth.signInWithPassword({ email, password });
    if (login.error) throw login.error;
    const result = await user.rpc('create_workspace', { workspace_name: workspace });
    if (result.error) throw result.error;
    return { email, password, generatedPassword: !env.ADMIN_PASSWORD, workspaceId: result.data };
  } catch (error) {
    const rollback = await admin.auth.admin.deleteUser(created.data.user.id);
    if (rollback.error) throw Error('Setup failed and the new account could not be removed. Review it in Supabase Auth before retrying.');
    throw error;
  } finally {
    await user.auth.signOut({ scope: 'local' });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createFirstAdmin(process.env).then(result => {
    console.log(`Created administrator ${result.email}. Workspace: ${result.workspaceId}.`);
    if (result.generatedPassword) console.log(`Save this initial password now: ${result.password}`);
    console.log('Sign in, set your password, and enable MFA in your profile. Remove ADMIN_* values from your environment after setup.');
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
