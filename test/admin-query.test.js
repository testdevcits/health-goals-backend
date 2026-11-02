const {test}=require('node:test');
const assert=require('node:assert/strict');
process.env.USE_MONGODB='false';process.env.JWT_SECRET='test';process.env.JWT_REFRESH_SECRET='test-refresh';
const env=require('../src/config/env');
const {buildQuery,list,overview}=require('../src/services/admin-query.service');
const {User}=require('../src/models/user.model');
const {HealthRecord}=require('../src/models/health.model');
const {Device}=require('../src/models/device.model');
test('Mongo list applies filters, projection, stable sort, skip and limit before fetching',async()=>{
 env.useMongoDB=true;
 const originalFind=User.find;const originalCount=User.countDocuments;const calls={};
 User.find=query=>{calls.query=query;const chain={select(v){calls.select=v;return this;},sort(v){calls.sort=v;return this;},skip(v){calls.skip=v;return this;},limit(v){calls.limit=v;return this;},lean(){calls.lean=true;return this;},maxTimeMS(){return Promise.resolve([{_id:'507f1f77bcf86cd799439011',name:'User',email:'user@example.com',status:'ACTIVE'}]);}};return chain;};
 User.countDocuments=query=>({maxTimeMS:async()=>{calls.countQuery=query;return 50;}});
 try{
  const result=await list('users',{page:'3',limit:'10',status:'ACTIVE',q:'a.*',from:'2026-10-01',to:'2026-10-20'});
  assert.equal(calls.skip,20);assert.equal(calls.limit,10);assert.equal(calls.lean,true);assert.ok(calls.select.includes('-passwordHash'));
  assert.deepEqual(calls.sort,{createdAt:-1,_id:-1});assert.equal(calls.query.status,'ACTIVE');assert.equal(calls.query.$or[0].name.$regex,'a\\.\\*');assert.equal(result.totalPages,5);assert.equal(result.items[0].id,'507f1f77bcf86cd799439011');
 }finally{User.find=originalFind;User.countDocuments=originalCount;env.useMongoDB=false;}
});
test('overview uses counts and limits recent records instead of loading collections',async()=>{
 env.useMongoDB=true;const originals=[User.countDocuments,HealthRecord.countDocuments,Device.countDocuments,HealthRecord.find];let recentLimit;
 User.countDocuments=async()=>5;HealthRecord.countDocuments=async q=>q.createdAt?2:1000;Device.countDocuments=async()=>3;
 HealthRecord.find=()=>({sort(){return this;},limit(n){recentLimit=n;return this;},lean:async()=>[]});
 try{const result=await overview();assert.equal(result.records,1000);assert.equal(result.syncedToday,2);assert.equal(recentLimit,8);}
 finally{[User.countDocuments,HealthRecord.countDocuments,Device.countDocuments,HealthRecord.find]=originals;env.useMongoDB=false;}
});
test('query validation rejects malformed and excessive pagination',()=>{
 for(const params of [{page:'-1'},{limit:'500'},{q:'a'.repeat(101)},{from:'invalid'},{from:'2026-02-31'}])assert.throws(()=>buildQuery('users',params));
});
test('device filters use registered models across pages and filter platform/model together',async()=>{
 const {createDevice}=require('../src/models/device.model');
 const userId='device-filter-user';
 await createDevice(userId,{deviceType:'phone',deviceIdentifier:'filter-vivo',platform:'android',manufacturer:'Vivo',model:'V21'});
 await createDevice(userId,{deviceType:'phone',deviceIdentifier:'filter-pixel',platform:'android',model:'Pixel 9'});
 await createDevice(userId,{deviceType:'phone',deviceIdentifier:'filter-iphone',platform:'ios',model:'iPhone 16'});
 await createDevice(userId,{deviceType:'phone',deviceIdentifier:'filter-unknown',platform:'android'});
 const result=await list('devices',{userId,platform:'android',model:'V21',limit:'1',q:'vivo'});
 assert.equal(result.total,1);
 assert.equal(result.items[0].model,'V21');
 assert.deepEqual(result.deviceFilters.map(row=>row.model),['iPhone 16','Pixel 9','V21']);
 assert.equal((await list('devices',{userId,platform:'ios',model:'V21'})).total,0);
 assert.deepEqual(buildQuery('devices',{platform:'ios',model:'iPhone 16'}).query,{platform:'ios',model:'iPhone 16'});
 assert.throws(()=>buildQuery('devices',{model:{$ne:null}}));
});
