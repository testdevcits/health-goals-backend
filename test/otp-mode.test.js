const {test}=require('node:test');
const assert=require('node:assert/strict');
process.env.APP_MODE='live';process.env.USE_MONGODB='false';process.env.JWT_SECRET='mode-test-secret';process.env.JWT_REFRESH_SECRET='mode-test-refresh';
const env=require('../src/config/env');const mail=require('../src/services/mail.service');const otp=require('../src/services/otp.service');const crypto=require('crypto');
test('dev mode uses 123456 without invoking mail and still enforces single use',async()=>{
 const previous=mail.sendOtp;env.appMode='dev';let sent=false;mail.sendOtp=async()=>{sent=true;throw new Error('must not send');};
 try{const row=await otp.request({email:'dev@example.com',purpose:'login',payload:{}});assert.equal(row.deliveryMode,'development');assert.equal(sent,false);await assert.rejects(()=>otp.consume(row.challengeId,'654321'),/Invalid/);await otp.consume(row.challengeId,'123456');await assert.rejects(()=>otp.consume(row.challengeId,'123456'),/expired|limit/);}finally{env.appMode='live';mail.sendOtp=previous;}
});
test('live mode emails a randomly generated OTP and does not accept dev OTP',async()=>{
 const previous=mail.sendOtp;const random=crypto.randomInt;let sent;env.appMode='live';crypto.randomInt=()=>654321;mail.sendOtp=async(email,code)=>{sent=code;};
 try{const row=await otp.request({email:'live@example.com',purpose:'login',payload:{}});assert.equal(sent,'654321');assert.equal(row.deliveryMode,'email');await assert.rejects(()=>otp.consume(row.challengeId,'123456'),/Invalid/);await otp.consume(row.challengeId,sent);}finally{mail.sendOtp=previous;crypto.randomInt=random;}
});
test('dev challenges are rejected after switching to live',async()=>{
 env.appMode='dev';const row=await otp.request({email:'switch@example.com',purpose:'login',payload:{}});env.appMode='live';await assert.rejects(()=>otp.consume(row.challengeId,'123456'),/mode changed/);
});
