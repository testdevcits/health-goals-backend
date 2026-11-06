const {test}=require('node:test');const assert=require('node:assert/strict');
process.env.USE_MONGODB='false';process.env.JWT_SECRET='test';process.env.JWT_REFRESH_SECRET='test';
const health=require('../src/models/health.model');const {chart}=require('../src/services/record-chart.service');
test('charts include over 100 records and respect user, metric and date filters',async()=>{
 for(let index=0;index<125;index++)health.healthRecords.push({id:`chart-${index}`,user_id:'chart-user',metric_type:'steps',unit:'count',value:10,recorded_at:'2026-11-02T08:00:00Z'});
 health.healthRecords.push({id:'other-metric',user_id:'chart-user',metric_type:'heart_rate',unit:'bpm',value:70,recorded_at:'2026-10-01T08:00:00Z'},{id:'deleted',user_id:'chart-user',metric_type:'steps',unit:'count',value:999,deleted:true,recorded_at:'2026-11-02T08:00:00Z'},{id:'other-user',user_id:'other',metric_type:'steps',unit:'count',value:999,recorded_at:'2026-11-02T08:00:00Z'});
 const all=await chart('chart-user');assert.equal(all.items.length,2);assert.equal(all.items.find(row=>row.metric==='steps').count,125);assert.equal(all.items.find(row=>row.metric==='steps').value,1250);
 const filtered=await chart('chart-user',{metricType:'steps',from:'2026-11-01',to:'2026-11-03'});assert.equal(filtered.items.length,1);assert.equal(filtered.items[0].count,125);
 assert.equal((await chart('chart-user',{from:'2026-12-01'})).items.length,0);
});

test('date filters include exactly the selected IST day, including midnight snapshots',async()=>{
 for(const [id,time,value] of [['before','2026-11-03T18:29:59Z',900],['midnight','2026-11-03T18:30:00Z',400],['late','2026-11-04T18:29:59Z',600],['after','2026-11-04T18:30:00Z',900]]){
  health.healthRecords.push({id,user_id:'ist-user',metric_type:'steps',unit:'count',value,recorded_at:time});
 }
 const result=await chart('ist-user',{from:'2026-11-04',to:'2026-11-04'});
 assert.equal(result.items.length,1);assert.equal(result.items[0].day,'2026-11-04');assert.equal(result.items[0].value,1000);
});
test('daily distance totals add while vital readings average',async()=>{
 for(const [metric,unit,values] of [['distance','km',[2,3]],['heart_rate','bpm',[60,80]]]){
  values.forEach((value,index)=>health.healthRecords.push({id:`total-${metric}-${index}`,user_id:'totals-user',metric_type:metric,unit,value,recorded_at:'2026-11-04T08:00:00Z'}));
 }
 const result=await chart('totals-user');assert.equal(result.items.find(row=>row.metric==='distance').value,5);assert.equal(result.items.find(row=>row.metric==='heart_rate').value,70);
});

test('sync preserves historical Health Connect records beyond the mobile read window',async()=>{
 const old={id:'historical-sync',user_id:'retention-user',metric_type:'steps',unit:'count',value:5000,recorded_at:'2024-01-01T18:30:00Z',activityDate:'2024-01-02',source:'health_connect',source_record_id:'old-health-record'};
 health.healthRecords.push(old);
 const {syncRecords}=require('../src/services/health.service');
 const result=await syncRecords('retention-user',{includeRecords:false,records:[{metricType:'steps',unit:'count',value:100,recordedAt:new Date().toISOString(),source:'health_connect',sourceRecordId:'new-health-record'}]});
 assert.equal(result.pruned,0);assert.ok(health.healthRecords.includes(old));
});

test('blood pressure components stay separate in daily charts',async()=>{
 for(const [component,value] of [['systolic',120],['diastolic',80]])health.healthRecords.push({id:component,user_id:'bp-user',metric_type:'blood_pressure',unit:'mmHg',value,recorded_at:'2026-11-04T08:00:00Z',metadata:{component}});
 const result=await chart('bp-user');assert.equal(result.items.length,2);assert.equal(result.items.find(row=>row.component==='systolic').value,120);assert.equal(result.items.find(row=>row.component==='diastolic').value,80);
});
test('canonical steps supersede legacy daily snapshots without deleting history',async()=>{
 const {syncRecords}=require('../src/services/health.service');
 const date='2026-01-04',time=`${date}T00:00:00+05:30`;
 const common={metricType:'steps',unit:'count',source:'health_connect',recordedAt:time,startTime:time,endTime:`${date}T23:59:59+05:30`,dataOrigin:'phone',recordingMethod:'automatic'};
 await syncRecords('snapshot-user',{records:[{...common,value:4000,sourceRecordId:`daily-steps:${date}:phone`},{...common,value:4500,sourceRecordId:`daily-steps:${date}:watch`}]});
 const canonical={...common,value:4600,sourceRecordId:`daily-steps:${date}:aggregate`,sourceVersion:Date.now(),metadata:{aggregation:'daily_total',aggregationScope:'health_connect'}};
 await syncRecords('snapshot-user',{records:[canonical]});
 const result=await chart('snapshot-user');assert.equal(result.items[0].value,4600);assert.equal(result.items[0].count,1);
 const rows=(await health.listAdmin()).filter(row=>row.userId==='snapshot-user');assert.equal(rows.length,3);assert.equal(rows.filter(row=>row.deleted).length,2);
 await syncRecords('snapshot-user',{records:[canonical]});assert.equal((await chart('snapshot-user')).items[0].value,4600);
});

test('daily API averages vital readings and keeps BP components separate',async()=>{
 const {getDailyHistory}=require('../src/services/health.service');
 const bp=await getDailyHistory('bp-user',{metricType:'blood_pressure',from:'2026-11-04',to:'2026-11-04'});
 assert.equal(bp.length,2);assert.equal(bp.find(row=>row.component==='systolic').value,120);
 const heart=await getDailyHistory('totals-user',{metricType:'heart_rate',from:'2026-11-04',to:'2026-11-04'});
 assert.equal(heart[0].value,70);
 await assert.rejects(()=>getDailyHistory('totals-user',{metricType:'steps',from:'2026-02-31',to:'2026-03-04'}));
});
