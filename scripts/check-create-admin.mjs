import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFirstAdmin } from './create-admin.mjs';
const env = { SUPABASE_URL: 'http://127.0.0.1:8000', SUPABASE_SERVICE_ROLE_KEY: 'service-test', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-test', ADMIN_EMAIL: 'owner@studio.test', ADMIN_NAME: 'Test Owner', ADMIN_WORKSPACE: 'Test Studio' };
function mock({ owners = 0, countError = null, rpcError = null } = {}) {
  const calls = [];
  const factory = (url, key) => ({
    from: table => ({ select: () => ({ eq: async () => ({ count: owners, error: countError }) }) }),
    auth: { admin: { createUser: async payload => { calls.push(['create', payload]); return { data: { user: { id: 'new-user' } }, error: null }; }, deleteUser: async id => { calls.push(['delete', id]); return { error: null }; } }, signInWithPassword: async payload => { calls.push(['login', key]); return { error: null }; }, signOut: async () => { calls.push(['signout']); } },
    rpc: async (name, args) => { calls.push(['rpc', key, name, args]); return { data: 'new-workspace', error: rpcError }; },
  });
  return { factory, calls };
}
test('creates only a provisioned first owner, using an authenticated RPC for membership', async () => {
  const m = mock(); const result = await createFirstAdmin(env, m.factory);
  assert.equal(result.email, env.ADMIN_EMAIL); assert.equal(result.workspaceId, 'new-workspace'); assert.ok(result.password.length >= 32);
  assert.equal(m.calls[0][1].app_metadata.pms_admin_provisioned, true);
  assert.deepEqual(m.calls.find(c => c[0] === 'rpc'), ['rpc', 'anon-test', 'create_workspace', { workspace_name: 'Test Studio' }]);
});
test('refuses an existing administrator without creating or changing accounts', async () => { const m=mock({owners:1}); await assert.rejects(createFirstAdmin(env,m.factory),/already exists/); assert.deepEqual(m.calls,[]); });
test('fails closed when the owner count cannot be established', async () => { const m=mock({owners:null}); await assert.rejects(createFirstAdmin(env,m.factory),/count/); assert.deepEqual(m.calls,[]); });
test('rolls back only the newly created identity on workspace failure', async () => { const m=mock({rpcError:Error('database failure')}); await assert.rejects(createFirstAdmin(env,m.factory),/database failure/); assert.ok(m.calls.some(c=>c[0]==='delete'&&c[1]==='new-user')); });
test('rejects insecure remote configuration before any database call', async () => { const m=mock(); await assert.rejects(createFirstAdmin({...env,SUPABASE_URL:'http://database.example.com'},m.factory),/HTTPS/); assert.deepEqual(m.calls,[]); });
