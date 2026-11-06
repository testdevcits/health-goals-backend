const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.USE_MONGODB = 'false'; process.env.JWT_SECRET = 'test'; process.env.JWT_REFRESH_SECRET = 'test';
const service = require('../src/services/health.service');
const health = require('../src/models/health.model');
const { METRIC_UNITS } = require('../src/services/health-metrics');
const { chart } = require('../src/services/record-chart.service');
const { memoryDays } = require('../src/models/daily-activity.model');
const day = '2024-02-05';
const record = (metricType, index = 0) => ({
  metricType, unit: METRIC_UNITS[metricType], value: ({heart_rate:70,weight:75,blood_pressure:120,oxygen_saturation:98,water_checkin:1,sleep_checkin:1})[metricType] || 30,
  source:'app',sourceRecordId:`flow:${metricType}:${index}`,recordedAt:`${day}T01:00:00+05:30`,sourceVersion:10,
  ...(['workout','meditation'].includes(metricType)?{startTime:`${day}T01:00:00+05:30`,endTime:`${day}T01:30:00+05:30`,activityType:'cycling'}:{}),
  ...(metricType==='blood_pressure'?{metadata:{component:'systolic'}}:{}),
});
test('all supported metrics round trip, replace, delete and remain isolated by user',async()=>{
 const rows=Object.keys(METRIC_UNITS).map(metric=>record(metric));
 const result=await service.syncRecords('flow-user',{records:rows,includeRecords:false});
 assert.equal(result.created,rows.length);assert.equal(memoryDays.get(`flow-user:${day}`).revision,1);
 assert.equal((await service.syncRecords('flow-user',{records:rows})).duplicates,rows.length);
 assert.equal((await chart('flow-user')).items.length,rows.length);
 const corrected=rows.map(row=>({...row,sourceVersion:11,value:row.value}));
 assert.equal((await service.syncRecords('flow-user',{records:corrected})).updated,rows.length);
 assert.equal((await service.syncRecords('flow-other',{records:rows})).created,rows.length);
 await service.syncRecords('flow-user',{records:corrected.map(row=>({...row,sourceVersion:12,deleted:true}))});
 assert.equal((await chart('flow-user')).items.length,0);assert.equal((await chart('flow-other')).items.length,rows.length);
 assert.deepEqual(await service.getSummary('flow-user'),{});
 assert.equal((await service.getDashboard('flow-user')).latestRecords.length,0);
});
test('vital batches do not enqueue unrelated daily reward jobs',async()=>{
 await service.syncRecords('vital-only',{records:['heart_rate','weight','blood_pressure','oxygen_saturation'].map(metric=>record(metric))});
 assert.equal(memoryDays.has(`vital-only:${day}`),false);
});
test('all-record pagination and summary cover more than 100 rows',async()=>{
 for(let i=0;i<125;i++)health.healthRecords.push({id:`pagination-${String(i).padStart(3,'0')}`,user_id:'page-user',metric_type:'distance',value:2,unit:'km',recorded_at:`${day}T01:00:00Z`});
 const one=await service.getRecordsPage('page-user',{userId:'flow-other',limit:'100'});
 const two=await service.getRecordsPage('page-user',{page:'2',limit:'100'});
 assert.equal(one.records.length,100);assert.equal(one.nextPage,2);assert.equal(two.records.length,25);assert.equal(two.hasMore,false);
 assert.equal(new Set([...one.records,...two.records].map(row=>row.id)).size,125);
 assert.equal((await service.getSummary('page-user')).distance,250);
});
test('vital averages use sample counts, not an average of averages',async()=>{
 await service.syncRecords('weighted-user',{records:[{...record('heart_rate',1),value:60,metadata:{sampleCount:9}},{...record('heart_rate',2),value:100,metadata:{sampleCount:1}}]});
 assert.equal((await chart('weighted-user')).items[0].value,64);
 assert.equal((await service.getDailyHistory('weighted-user',{metricType:'heart_rate',from:day,to:day}))[0].value,64);
 assert.equal((await service.getSummary('weighted-user')).heart_rate,64);
});
test('invalid units, device selectors, dates and duplicate identities fail before writes',async()=>{
 for(const bad of [{...record('weight'),unit:'bpm'},{...record('weight'),deviceId:{$ne:null}},{...record('weight'),value:' '},{...record('heart_rate'),metadata:{sampleCount:-1}},{...record('blood_pressure'),metadata:{component:'mean'}}]){
  await assert.rejects(()=>service.syncRecords('validation-user',{records:[record('distance'),bad]}),error=>error.statusCode===400);
 }
 await assert.rejects(()=>service.syncRecords('validation-user',{records:[record('distance'),record('distance')]}));
 await assert.rejects(()=>service.syncRecords('validation-user',null));
 assert.equal((await chart('validation-user')).items.length,0);
});

test('a device owned by another user cannot upload any metric',async()=>{
 const devices=require('../src/models/device.model');
 const device=await devices.createDevice('device-owner',{deviceType:'phone',deviceIdentifier:'health-flow-private-device'});
 for(const metric of Object.keys(METRIC_UNITS))await assert.rejects(()=>service.syncRecords('device-attacker',{records:[{...record(metric),deviceId:device.id,userId:'device-owner'}]}),error=>error.statusCode===403);
 assert.equal((await chart('device-attacker')).items.length,0);
 await service.syncRecords('device-owner',{records:[{...record('weight'),deviceId:device.id,userId:'device-attacker'}]});
 assert.equal((await chart('device-owner')).items.length,1);assert.equal((await chart('device-attacker')).items.length,0);
});

test('a stale source version cannot hide an identity mismatch',async()=>{
 const original={...record('weight'),sourceRecordId:'immutable-source'};
 await service.syncRecords('immutable-user',{records:[original]});
 await assert.rejects(()=>service.syncRecords('immutable-user',{records:[{...record('heart_rate'),sourceRecordId:'immutable-source',sourceVersion:1}]}),error=>error.statusCode===409);
});
test('existing identity conflicts are detected before any batch record is changed',async()=>{
 const original={...record('weight'),sourceRecordId:'conflict-source'};
 await service.syncRecords('conflict-user',{records:[original]});
 await assert.rejects(()=>service.syncRecords('conflict-user',{records:[record('distance'),{...original,sourceVersion:11,recordedAt:'2024-02-06T01:00:00+05:30'}]}),error=>error.statusCode===409);
 assert.deepEqual((await chart('conflict-user')).items.map(row=>row.metric),['weight']);
});
test('legacy clients cannot resurrect superseded step snapshots',async()=>{
 const date='2024-02-05',common={metricType:'steps',unit:'count',recordedAt:`${date}T00:00:00+05:30`,startTime:`${date}T00:00:00+05:30`,endTime:`${date}T23:59:59+05:30`,source:'health_connect',dataOrigin:'phone',recordingMethod:'automatic'};
 const legacy={...common,value:4000,sourceVersion:1,sourceRecordId:`daily-steps:${date}:phone`};
 const canonical={...common,value:4500,sourceVersion:10,sourceRecordId:`daily-steps:${date}:aggregate`,metadata:{aggregation:'daily_total',aggregationScope:'health_connect'}};
 await service.syncRecords('legacy-client-user',{records:[legacy]});
 await service.syncRecords('legacy-client-user',{records:[canonical]});
 await service.syncRecords('legacy-client-user',{records:[{...legacy,value:5000,sourceVersion:100}]});
 assert.equal((await chart('legacy-client-user')).items[0].value,4500);
});

test('legacy daily endpoint reports the authoritative total when its payload is superseded',async()=>{
 const date='2024-02-05';
 const response=await service.syncDailySteps('legacy-client-user',{date,steps:9000,dataOrigin:'phone'});
 assert.equal(response.superseded,true);assert.equal(response.duplicate,true);assert.equal(response.steps,4500);
});
