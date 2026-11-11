const {test}=require('node:test');const assert=require('node:assert/strict');
process.env.USE_MONGODB='false';process.env.APP_MODE='dev';process.env.NODE_ENV='test';process.env.JWT_SECRET='session-test-access';process.env.JWT_REFRESH_SECRET='session-test-refresh';
const auth=require('../src/services/auth.service');const jwt=require('jsonwebtoken');const {authenticate}=require('../src/middleware/auth.middleware');
const check=token=>new Promise(resolve=>authenticate({headers:{authorization:`Bearer ${token}`}}, {},error=>resolve(error)));
let current;
test('OTP login sets one-hour deadline with short access token',async()=>{
 const start=await auth.register({name:'Session User',email:'session@example.test',password:'password123'});current=await auth.verifyOtp({challengeId:start.challengeId,otp:'123456'});
 const claims=jwt.decode(current.accessToken);assert.ok([3599,3600].includes(claims.sessionExpiresAt-claims.iat));assert.equal(claims.exp-claims.iat,900);assert.equal(current.sessionExpiresAt,claims.sessionExpiresAt*1000);
});
test('refresh rotates tokens without extending session and rejects reused refresh tokens',async()=>{
 const old=current;current=await auth.refresh({refreshToken:old.refreshToken});assert.equal(current.sessionExpiresAt,old.sessionExpiresAt);assert.notEqual(current.refreshToken,old.refreshToken);await assert.rejects(()=>auth.refresh({refreshToken:old.refreshToken}),/Invalid refresh token/);
 const outcomes=await Promise.allSettled([auth.refresh({refreshToken:current.refreshToken}),auth.refresh({refreshToken:current.refreshToken})]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);current=outcomes.find(x=>x.status==='fulfilled').value;
});
test('absolute one-hour expiry rejects refresh and access',async()=>{
 const original=Date.now;try{Date.now=()=>current.sessionExpiresAt+1000;await assert.rejects(()=>auth.refresh({refreshToken:current.refreshToken}),/expired/);assert.ok(await check(current.accessToken));}finally{Date.now=original;}
});
test('manual logout revokes refresh and issued access tokens immediately',async()=>{
 assert.equal(await check(current.accessToken),undefined);await auth.logout(current.user.id);assert.ok(await check(current.accessToken));await assert.rejects(()=>auth.refresh({refreshToken:current.refreshToken}),/revoked/i);
});
