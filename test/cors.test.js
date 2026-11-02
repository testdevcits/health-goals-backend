const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.USE_MONGODB = 'false';
process.env.JWT_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
const env = require('../src/config/env');
const cors = require('../src/config/cors');
const check = origin => new Promise(resolve => cors.origin(origin, (error, allowed) => resolve({error, allowed})));
test('development accepts local frontend ports, rejects external and opaque origins', async () => {
 env.nodeEnv='development';
 for(const origin of ['http://localhost:3000','http://localhost:3001','http://127.0.0.1:5173','http://[::1]:3000',undefined]) assert.equal((await check(origin)).allowed,true);
 for(const origin of ['https://localhost.evil.example','https://other.example','null']) assert.equal((await check(origin)).error.statusCode,403);
});
test('production only accepts explicitly allowed origins',async()=>{
 env.nodeEnv='production';env.allowedOrigins=['https://admin.example.com'];
 assert.equal((await check('https://admin.example.com')).allowed,true);
 assert.equal((await check('http://localhost:3001')).error.details.code,'CORS_ORIGIN_DENIED');
});
