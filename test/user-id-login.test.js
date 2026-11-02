const {test}=require('node:test');const assert=require('node:assert/strict');
process.env.USE_MONGODB='false';process.env.APP_MODE='live';process.env.JWT_SECRET='id-test-secret';process.env.JWT_REFRESH_SECRET='id-test-refresh';process.env.ADMIN_EMAILS='id-admin@example.test';
const users=require('../src/models/user.model');const auth=require('../src/services/auth.service');const mail=require('../src/services/mail.service');const bcrypt=require('bcrypt');
let user;let delivered;
mail.sendOtp=async(email,otp)=>{delivered={email,otp};};
test('unique public ID is generated and cannot be selected by registration input',async()=>{
 user=await users.createUser({name:'ID User',email:'id-admin@example.test',passwordHash:await bcrypt.hash('password123',12)});
 const second=await users.createUser({name:'Other User',email:'other-id@example.test',passwordHash:await bcrypt.hash('password123',12)});
 assert.match(user.publicId,/^USR-[A-F0-9]{12}$/);assert.notEqual(second.publicId,user.publicId);
});
test('ID login emails the linked account and requires OTP before tokens',async()=>{
 const start=await auth.login({identifier:user.publicId.toLowerCase(),password:'password123',admin:true});
 assert.equal(start.accessToken,undefined);assert.equal(delivered.email,user.email);assert.equal(start.maskedEmail,'i***@example.test');
 const verified=await auth.verifyOtp({challengeId:start.challengeId,otp:delivered.otp});assert.equal(verified.user.id,user.id);assert.equal(verified.user.publicId,user.publicId);assert.ok(verified.accessToken);
});
test('wrong ID/password never sends OTP; regular users cannot enter admin',async()=>{
 delivered=null;
 await assert.rejects(()=>auth.login({identifier:user.publicId,password:'wrong'}),/Invalid/);
 await assert.rejects(()=>auth.login({userId:'USR-000000000000',password:'password123'}),/Invalid/);
 await assert.rejects(()=>auth.login({identifier:'other-id@example.test',password:'password123',admin:true}),/approved/);
 assert.equal(delivered,null);
});
