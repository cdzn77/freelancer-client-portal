import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {randomUUID,createHmac} from 'node:crypto';
const url=process.env.SUPABASE_URL!;
const admin=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
const client=()=>createClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
function totp(secret:string) {
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';
 for(const c of secret.toUpperCase().replace(/=+$/,'')) bits+=alphabet.indexOf(c).toString(2).padStart(5,'0');
 const key=Buffer.from((bits.match(/.{8}/g)||[]).map(b=>parseInt(b,2)));
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const hash=createHmac('sha1',key).update(counter).digest();const offset=hash[hash.length-1]&15;
 return String((hash.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
}
let id:string|undefined;
async function main(){try{
 const email=`pms-mfa-${randomUUID()}@example.invalid`,password='MfaFixture!'+randomUUID();
 const made=await admin.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{pms_admin_provisioned:true}});assert.ok(!made.error);id=made.data.user!.id;
 const c=client();assert.ok(!(await c.auth.signInWithPassword({email,password})).error);
 const enrollment=await c.auth.mfa.enroll({factorType:'totp',friendlyName:'Disposable MFA test'});assert.ok(!enrollment.error);
 const factor=enrollment.data!;
 const verification=await c.auth.mfa.challengeAndVerify({factorId:factor.id,code:totp(factor.totp.secret)});assert.ok(!verification.error,'Real TOTP verification failed');
 let status=await c.rpc('pms_security_status');assert.ok(!status.error);assert.equal(status.data.mfa_enrolled,true);assert.equal(status.data.mfa_required,false);
 const d=client();assert.ok(!(await d.auth.signInWithPassword({email,password})).error);
 status=await d.rpc('pms_security_status');assert.equal(status.data.mfa_required,true);
 assert.ok((await d.from('workspaces').select('id')).error,'MFA bypass through direct database');
 assert.ok((await d.rpc('create_workspace',{workspace_name:'Should never be created'})).error,'MFA bypass through RPC');
 console.log('PASS: real authenticator enrollment/TOTP, AAL2 acceptance, new password-only session denied database and privileged RPC access.');
 } finally{if(id){const removed=await admin.auth.admin.deleteUser(id);assert.ok(!removed.error,'Fixture cleanup failed');}console.log('Disposable MFA account removed.');}}
main().then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exitCode=1;});
