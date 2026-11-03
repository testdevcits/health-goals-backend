const {test}=require('node:test');const assert=require('node:assert/strict');
process.env.USE_MONGODB='false';process.env.JWT_SECRET='test';process.env.JWT_REFRESH_SECRET='test';
const health=require('../src/models/health.model');const {chart}=require('../src/services/record-chart.service');
test('charts include over 100 records and respect user, metric and date filters',async()=>{
 for(let index=0;index<125;index++)health.healthRecords.push({id:`chart-${index}`,user_id:'chart-user',metric_type:'steps',unit:'count',value:10,recorded_at:'2026-11-02T08:00:00Z'});
 health.healthRecords.push({id:'other-metric',user_id:'chart-user',metric_type:'heart_rate',unit:'bpm',value:70,recorded_at:'2026-10-01T08:00:00Z'},{id:'deleted',user_id:'chart-user',metric_type:'steps',unit:'count',value:999,deleted:true,recorded_at:'2026-11-02T08:00:00Z'},{id:'other-user',user_id:'other',metric_type:'steps',unit:'count',value:999,recorded_at:'2026-11-02T08:00:00Z'});
 const all=await chart('chart-user');assert.equal(all.items.length,2);assert.equal(all.items.find(row=>row.metric==='steps').count,125);assert.equal(all.items.find(row=>row.metric==='steps').value,10);
 const filtered=await chart('chart-user',{metricType:'steps',from:'2026-11-01',to:'2026-11-03'});assert.equal(filtered.items.length,1);assert.equal(filtered.items[0].count,125);
 assert.equal((await chart('chart-user',{from:'2026-12-01'})).items.length,0);
});
