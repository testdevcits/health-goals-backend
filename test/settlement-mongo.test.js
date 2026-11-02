const {test}=require('node:test');const assert=require('node:assert/strict');
const uri=process.env.SETTLEMENT_TEST_MONGO_URI;
if(!uri)test('Mongo settlement integration requires isolated SETTLEMENT_TEST_MONGO_URI',{skip:true},()=>{});
else {
 process.env.USE_MONGODB='true';process.env.APP_MODE='live';process.env.JWT_SECRET='test-settlement-secret';process.env.JWT_REFRESH_SECRET='test-settlement-refresh';
 const mongoose=require('mongoose');const health=require('../src/services/health.service');const ingestion=require('../src/services/activity-ingestion.service');const daily=require('../src/services/daily-settlement.service');const {DailyActivity}=require('../src/models/daily-activity.model');const {User}=require('../src/models/user.model');const wallet=require('../src/models/wallet.model');
 const now=new Date('2026-10-20T18:30:10Z');let sequence=0;
 const user=()=>User.create({name:'Settlement test',email:`settlement-${Date.now()}-${sequence++}@example.com`,passwordHash:'test-hash'});
 const steps=(id,value,extra={})=>({metricType:'steps',value,unit:'count',recordedAt:'2024-10-20T01:00:00Z',startTime:'2024-10-20T01:00:00Z',endTime:'2024-10-20T02:00:00Z',source:'health_connect',sourceRecordId:id,dataOrigin:'test-phone',recordingMethod:'automatic',...extra});
 test('persistent settlement: atomic credits, retries, late data, leases and bounded batches',async t=>{
  await mongoose.connect(uri);await Promise.all(Object.values(mongoose.models).map(m=>m.init()));
  try {
   const u=await user();
   await t.test('sync queues a historical day; duplicate and concurrent requests credit only once',async()=>{
    await health.createRecord(String(u._id),steps('s1',4000));assert.equal((await wallet.findWallet(u._id)).availablePoints,0);
    assert.equal((await health.createRecord(String(u._id),steps('s1',4000))).duplicate,true);
    await Promise.all([daily.processBatch({now}),daily.processBatch({now})]);assert.equal((await wallet.findWallet(u._id)).availablePoints,4);assert.equal(await wallet.WalletTransaction.countDocuments({userId:u._id}),1);
   });
   await t.test('late higher-version data only pays the difference and preserves previous revision',async()=>{
    await health.createRecord(String(u._id),steps('s1',6000,{sourceVersion:2}));await daily.processBatch({now});assert.equal((await wallet.findWallet(u._id)).availablePoints,6);assert.equal(await ingestion.HealthRevision.countDocuments({userId:u._id}),1);
    await health.createRecord(String(u._id),steps('s1',1000,{sourceVersion:1}));assert.equal((await daily.progress(String(u._id),'2024-10-20')).totals.steps,6000);
   });
   await t.test('corrections keep the audit history without subtracting previously spent coins',async()=>{
    await health.createRecord(String(u._id),steps('s1',0,{sourceVersion:3,deleted:true}));await daily.processBatch({now});assert.equal((await wallet.findWallet(u._id)).availablePoints,6);const p=await daily.progress(String(u._id),'2024-10-20');assert.equal(p.entitledCoins,0);assert.equal(p.creditedCoins,6);
   });
   await t.test('a failure after wallet write rolls the full transaction back and resumes later',async()=>{
    const v=await user();await health.createRecord(String(v._id),steps('failure',4000));const update=DailyActivity.updateOne;let inject=true;
    DailyActivity.updateOne=function(filter,change,options){if(inject&&change.$set?.state==='SETTLED'){inject=false;throw new Error('Injected failure after wallet credit');}return update.call(this,filter,change,options);};
    try{assert.equal((await daily.processBatch({now})).failed,1);}finally{DailyActivity.updateOne=update;}
    assert.equal((await wallet.findWallet(v._id)).availablePoints,0);assert.equal(await wallet.WalletTransaction.countDocuments({userId:v._id}),0);
    await daily.processBatch({now:new Date(+now+60000)});assert.equal((await wallet.findWallet(v._id)).availablePoints,4);
   });
   await t.test('expired worker leases are reclaimed after restart; data survives a new DB connection',async()=>{
    const v=await user();await health.createRecord(String(v._id),steps('restart',2000));const claimed=await daily.claim(now);assert.ok(claimed);
    await mongoose.disconnect();await mongoose.connect(uri);assert.equal((await daily.processBatch({now:new Date(+now+121000)})).settled,1);assert.equal((await wallet.findWallet(v._id)).availablePoints,2);assert.equal((await daily.history(String(u._id))).items[0].day,'2024-10-20');
   });
   await t.test('one batch processes at most 20 user/day jobs',async()=>{
    for(let i=0;i<23;i++){const v=await user();await health.createRecord(String(v._id),{metricType:'water_checkin',value:1,unit:'checkin',recordedAt:'2024-10-20T01:00:00Z',source:'app',sourceRecordId:`habit-${i}`});}
    const result=await daily.processBatch({now,batchSize:100,concurrency:100});assert.equal(result.claimed,20);assert.equal(result.settled,20);assert.equal((await daily.processBatch({now})).settled,3);
   });
   await t.test('today remains pending until midnight IST',async()=>{
    const v=await user();await health.createRecord(String(v._id),{metricType:'water_checkin',value:1,unit:'checkin',recordedAt:'2026-10-20T01:00:00Z',source:'app',sourceRecordId:'today'});
    assert.equal((await daily.processBatch({now:new Date('2026-10-20T18:29:59Z')})).claimed,0);assert.equal((await daily.processBatch({now})).settled,1);
   });
  } finally {await mongoose.disconnect();}
 });
}
