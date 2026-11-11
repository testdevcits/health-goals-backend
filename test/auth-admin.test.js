const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.APP_MODE = 'live';
process.env.USE_MONGODB = 'false';
process.env.JWT_SECRET = 'test-only-access-secret-that-is-long';
process.env.JWT_REFRESH_SECRET = 'test-only-refresh-secret-that-is-long';
process.env.ADMIN_EMAILS = 'admin@example.com';
const mail = require('../src/services/mail.service');
const delivered = new Map();
mail.sendOtp = async (email, code) => { delivered.set(email, code); };
const app = require('../src/server');
const users = require('../src/models/user.model');
const jwt = require('jsonwebtoken');
const otpService = require('../src/services/otp.service');
let server, base;
before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}/api/v1`; });
after(async () => { await new Promise(r => server.close(r)); });
async function request(path, body, token) {
 const res = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { ...(body ? {'Content-Type':'application/json'} : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
 return { status: res.status, ...(await res.json()) };
}
let adminToken, userToken;
test('registration requires an emailed, single-use OTP before creating the admin', async () => {
 const start = await request('/auth/register', { name: 'Admin', email: 'ADMIN@example.com', password: 'password123', admin: true });
 assert.equal(start.status, 202); assert.equal(start.data.accessToken, undefined); assert.equal(start.data.otp, undefined);
 assert.equal(await users.findUserByEmail('admin@example.com'), null);
 assert.equal((await request('/auth/verify-otp', { challengeId: start.data.challengeId, otp:'000000' })).status, 401);
 const verified = await request('/auth/verify-otp', { challengeId: start.data.challengeId, otp: delivered.get('admin@example.com') });
 assert.equal(verified.status, 200); assert.equal(verified.data.user.role, 'ADMIN'); adminToken = verified.data.accessToken;
 assert.equal((await request('/auth/verify-otp', { challengeId: start.data.challengeId, otp: delivered.get('admin@example.com') })).status, 401);
});
test('password login returns a challenge, and OTP verification issues a token', async () => {
 const start = await request('/auth/login', { email:'admin@example.com',password:'password123',admin:true });
 assert.equal(start.status,202); assert.equal(start.data.token,undefined);
 const verified = await request('/auth/verify-otp', { challengeId:start.data.challengeId, otp:delivered.get('admin@example.com') });
 assert.equal(verified.status,200); adminToken=verified.data.accessToken;
});
test('normal users cannot elevate themselves or access admin data', async () => {
 const start=await request('/auth/register',{name:'User',email:'user@example.com',password:'password123',role:'ADMIN'});
 const verified=await request('/auth/verify-otp',{challengeId:start.data.challengeId,otp:delivered.get('user@example.com')});
 assert.equal(verified.data.user.role,'USER'); userToken=verified.data.accessToken;
 assert.equal((await request('/admin/users',null,userToken)).status,403);
 assert.equal((await request('/auth/login',{email:'user@example.com',password:'password123',admin:true})).status,403);
});
test('admin lists live app data; anonymous and pre-OTP tokens are rejected',async()=>{
 assert.equal((await request('/admin/overview')).status,401);
 const old=jwt.sign({sub:jwt.decode(adminToken).sub},process.env.JWT_SECRET);
 assert.equal((await request('/admin/overview',null,old)).status,401);
 const overview=await request('/admin/overview',null,adminToken);assert.equal(overview.status,200);assert.equal(overview.data.users,2);
 const list=await request('/admin/users?q=user%40example.com',null,adminToken);assert.equal(list.data.total,1);assert.equal(list.data.items[0].password_hash,undefined);
 const sync=await request('/health/sync',{records:[{metricType:'steps',value:1500,unit:'count',recordedAt:new Date().toISOString(),source:'health_connect',sourceRecordId:'test-steps-1'}]},userToken);assert.ok(sync.status<300);
 const records=await request('/admin/records?metricType=steps',null,adminToken);assert.equal(records.data.total,1);assert.equal(records.data.items[0].value,1500);
});
test('OTP cooldown, expiry and attempt limit are enforced',async()=>{
 const row=await otpService.request({email:'limits@example.com',purpose:'login',payload:{}});
 await assert.rejects(()=>otpService.request({email:'limits@example.com',purpose:'login',payload:{}}),/60 seconds/);
 for(let i=0;i<5;i++)await assert.rejects(()=>otpService.consume(row.challengeId,'000000'),/Invalid verification/);
 await assert.rejects(()=>otpService.consume(row.challengeId,delivered.get('limits@example.com')),/attempt limit/);
 const now=Date.now;let expired;try{Date.now=()=>now()-360000;expired=await otpService.request({email:'expired@example.com',purpose:'login',payload:{}});}finally{Date.now=now;}
 await assert.rejects(()=>otpService.consume(expired.challengeId,delivered.get('expired@example.com')),/expired/);
});
test('email delivery failure never issues a usable challenge or account',async()=>{
 const sender=mail.sendOtp;mail.sendOtp=async()=>{throw new Error('SMTP unavailable');};
 try{await assert.rejects(()=>otpService.request({email:'failed@example.com',purpose:'register',payload:{}}),/SMTP unavailable/);assert.equal(await users.findUserByEmail('failed@example.com'),null);}finally{mail.sendOtp=sender;}
});

test('user details and database-style pagination validate and isolate records', async()=>{
 const u=await users.findUserByEmail('user@example.com');
 const detail=await request(`/admin/users/${u.id}`,null,adminToken);
 assert.equal(detail.status,200);assert.equal(detail.data.user.email,'user@example.com');assert.equal(detail.data.recordCount,1);assert.equal(detail.data.canChangeStatus,true);
 const first=await request('/admin/users?limit=1&page=1',null,adminToken);
 const second=await request('/admin/users?limit=1&page=2',null,adminToken);
 assert.equal(first.data.items.length,1);assert.equal(first.data.totalPages,2);assert.notEqual(first.data.items[0].id,second.data.items[0].id);
 assert.equal((await request('/admin/records?limit=101',null,adminToken)).status,400);
 assert.equal((await request('/admin/records?from=2026-02-31',null,adminToken)).status,400);
 assert.equal((await request('/admin/records?from=2026-10-20&to=2026-10-01',null,adminToken)).status,400);
 assert.equal((await request('/admin/users/missing',null,adminToken)).status,404);
});
async function patchStatus(id,status,token){
 const res=await fetch(`${base}/admin/users/${id}/status`,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({status})});
 return {status:res.status,...await res.json()};
}
test('coin rule and activity admin APIs enforce access, versions, validation and retry-safe entries',async()=>{
 const {RULES}=require('../src/services/daily-rules');
 const ruleService=require('../src/services/coin-rules.service');
 const fields=Object.fromEntries(ruleService.fields.map(key=>[key,RULES[key]]));
 assert.equal((await request('/admin/coin-rules')).status,401);
 assert.equal((await request('/admin/coin-rules',null,userToken)).status,403);
 assert.equal((await request('/admin/coin-rules',{rules:fields,note:'Unauthorized',baseVersion:RULES.version},userToken)).status,403);
 const version=await request('/admin/coin-rules',{rules:{...fields,stepTierCoins:3},note:'Test version',baseVersion:RULES.version},adminToken);
 assert.equal(version.status,201);
 assert.equal((await request('/admin/coin-rules',{rules:fields,note:'Stale',baseVersion:RULES.version},adminToken)).status,409);
 const history=await request('/admin/coin-rules',null,adminToken);
 assert.equal(history.data.current.version,RULES.version);assert.equal(history.data.items.length,1);
 const u=await users.findUserByEmail('user@example.com');
 const body={metricType:'steps',value:4000,day:'2020-01-01',startTime:'2020-01-01T07:00:00+05:30',endTime:'2020-01-01T08:00:00+05:30',note:'Manual admin record',entryId:'admin-activity-test-12345'};
 assert.equal((await request(`/admin/users/${u.id}/activities`,body,userToken)).status,403);
 const added=await request(`/admin/users/${u.id}/activities`,body,adminToken);
 assert.equal(added.status,201);assert.equal(added.data.record.recordingMethod,'manual');assert.equal(added.data.record.metadata.adminEntered,true);
 assert.equal((await request(`/admin/users/${u.id}/activities`,body,adminToken)).data.duplicate,true);
 const progress=await request(`/admin/users/${u.id}/daily?day=2020-01-01`,null,adminToken);
 assert.equal(progress.data.entitledCoins,0);assert.equal(progress.data.rules.version,RULES.version);
 assert.equal((await request(`/admin/users/${u.id}/activities`,{...body,day:'invalid'},adminToken)).status,400);
 const habit={metricType:'water_checkin',value:1,day:'2020-01-01',note:'Test habit',entryId:'admin-activity-test-habit'};
 assert.equal((await request(`/admin/users/${u.id}/activities`,habit,adminToken)).status,201);
 const pending=await request(`/admin/users/${u.id}/settlements?from=2020-01-01&to=2020-01-01`,null,adminToken);
 assert.equal(pending.data.total,1);assert.equal(pending.data.items[0].pendingCoins,1);
 assert.equal((await request(`/admin/users/${u.id}/transactions`,null,userToken)).status,403);
 assert.equal((await request(`/admin/users/${u.id}/transactions`,null,adminToken)).data.total,0);
 assert.equal((await request(`/admin/users/${u.id}/settlements?from=invalid`,null,adminToken)).status,400);
});
test('suspension revokes sessions permanently and admins cannot suspend themselves',async()=>{
 const u=await users.findUserByEmail('user@example.com');const admin=await users.findUserByEmail('admin@example.com');
 assert.equal((await patchStatus(admin.id,'SUSPENDED',adminToken)).status,403);
 assert.equal((await patchStatus(u.id,'INVALID',adminToken)).status,400);
 assert.equal((await patchStatus(u.id,'SUSPENDED',userToken)).status,403);
 assert.equal((await patchStatus(u.id,'SUSPENDED',adminToken)).data.user.status,'SUSPENDED');
 assert.equal((await request('/auth/me',null,userToken)).status,401);
 assert.equal((await request('/auth/login',{email:'user@example.com',password:'password123'})).status,403);
 assert.equal((await request('/admin/users?status=SUSPENDED',null,adminToken)).data.total,1);
 assert.equal((await patchStatus(u.id,'ACTIVE',adminToken)).status,200);
 assert.equal((await request('/auth/me',null,userToken)).status,401);
 const start=await request('/auth/login',{email:'user@example.com',password:'password123'});
 const login=await request('/auth/verify-otp',{challengeId:start.data.challengeId,otp:delivered.get('user@example.com')});
 assert.equal(login.status,200);userToken=login.data.accessToken;assert.equal((await request('/auth/me',null,userToken)).status,200);
});

async function requestMethod(path, method, body, token) {
 const res=await fetch(base+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
 return {status:res.status,...await res.json()};
}
test('admin operations analytics, audit filters, bulk user status, and device status are enforced',async()=>{
 const user=await users.findUserByEmail('user@example.com');
 const analytics=await request('/admin/analytics?from=2026-01-01&to=2026-12-31',null,adminToken);
 assert.equal(analytics.status,200);assert.equal(analytics.data.timezone,'Asia/Kolkata');assert.ok(Array.isArray(analytics.data.records));
 const audit=await request(`/admin/audit-logs?userId=${user.id}&limit=5`,null,adminToken);
 assert.equal(audit.status,200);assert.ok(audit.data.items.length<=5);assert.equal(audit.data.page,1);
 assert.equal((await request('/admin/audit-logs',null,userToken)).status,403);
 const deviceModel=require('../src/models/device.model');const device=await deviceModel.createDevice(user.id,{deviceType:'phone',deviceIdentifier:'admin-ops-device',platform:'android',model:'Test Phone'});
 assert.equal((await request('/admin/devices',null,userToken)).status,403);
 const removed=await requestMethod(`/admin/devices/${device.id}/status`,'PATCH',{status:'REMOVED'},adminToken);
 assert.equal(removed.status,200);assert.equal(removed.data.device.status,'REMOVED');
 const bulk=await request('/admin/users/bulk-status',{ids:[user.id,'missing-user-id'],status:'SUSPENDED'},adminToken);
 assert.equal(bulk.status,200);assert.equal(bulk.data.succeeded,1);assert.equal(bulk.data.failed,1);assert.equal(bulk.data.results[0].status,'SUSPENDED');
 assert.equal((await request('/admin/users/bulk-status',{ids:[user.id],status:'REMOVED'},adminToken)).status,400);
});
test('settlement queue exposes retryable jobs and queues admin retry safely',async()=>{
 const user=await users.findUserByEmail('user@example.com');
 const daily=require('../src/services/daily-settlement.service');
 await daily.enqueue(user.id,'2020-01-02');
 const queue=await request('/admin/settlements/queue?state=PENDING',null,adminToken);
 assert.equal(queue.status,200);const row=queue.data.items.find(item=>item.day==='2020-01-02'&&item.user?.id===user.id);assert.ok(row);
 const retried=await request(`/admin/settlements/${row.id}/retry`,{},adminToken);
 assert.equal(retried.status,200);
 const processing=require('../src/models/daily-activity.model').memoryDays.get(`${user.id}:2020-01-02`);
 processing.state='PROCESSING';processing.lockUntil=new Date(Date.now()+60000);processing.leaseToken='active-lease';
 assert.equal((await request(`/admin/settlements/${row.id}/retry`,{},adminToken)).status,404);
 assert.equal((await request(`/admin/settlements/${row.id}/retry`,{},userToken)).status,401);
});
test('full admin can scope sub-admin permissions and sub-admin routes honor them',async()=>{
 const created=await request('/admin/administrators',{name:'Scoped Admin',email:'scoped-admin@example.com',password:'temporary-pass-123'},adminToken);
 assert.equal(created.status,201);const id=created.data.administrator.id;
 const saved=await requestMethod(`/admin/administrators/${id}/permissions`,'PATCH',{permissions:['records:read']},adminToken);
 assert.equal(saved.status,200);assert.deepEqual(saved.data.administrator.adminPermissions,['records:read']);
 const start=await request('/auth/login',{identifier:'scoped-admin@example.com',password:'temporary-pass-123'});
 assert.equal(start.status,202);const login=await request('/auth/verify-otp',{challengeId:start.data.challengeId,otp:delivered.get('scoped-admin@example.com')});
 assert.equal(login.status,200);assert.equal((await request('/admin/records',null,login.data.accessToken)).status,200);assert.equal((await request('/admin/users',null,login.data.accessToken)).status,403);
 const ordinary=await request('/auth/register',{name:'Ordinary',email:'ordinary-access@example.com',password:'password123'});
 const ordinaryLogin=await request('/auth/verify-otp',{challengeId:ordinary.data.challengeId,otp:delivered.get('ordinary-access@example.com')});
 assert.equal((await requestMethod(`/admin/administrators/${id}/permissions`,'PATCH',{permissions:[]},ordinaryLogin.data.accessToken)).status,403);
});
