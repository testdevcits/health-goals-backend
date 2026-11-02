const {test}=require('node:test');const assert=require('node:assert/strict');
const {calculate,dayKey,dayEnd,RULES}=require('../src/services/daily-rules');
const interval=(metricType,value,startTime,endTime,extra={})=>({metricType,value,startTime,endTime,source:'health_connect',dataOrigin:'phone',recordingMethod:'automatic',...extra});
test('IST midnight boundaries and historical dates',()=>{assert.equal(dayKey('2024-01-01T18:29:59Z'),'2024-01-01');assert.equal(dayKey('2024-01-01T18:30:00Z'),'2024-01-02');assert.equal(dayEnd('2024-01-01').toISOString(),'2024-01-01T18:30:00.000Z');});
test('step tiers, overlap deduplication and separate device origins do not double rewards',()=>{
 const rows=[interval('steps',4000,'2024-01-01T01:00Z','2024-01-01T02:00Z'),interval('steps',4000,'2024-01-01T01:00Z','2024-01-01T02:00Z',{dataOrigin:'watch'}),interval('steps',2000,'2024-01-01T01:30Z','2024-01-01T02:30Z')];
 assert.equal(calculate(rows).steps,4000);assert.equal(calculate(rows).entitledCoins,4);
 rows.push(interval('steps',5000,'2024-01-01T03:00Z','2024-01-01T04:00Z'));assert.equal(calculate(rows).breakdown.steps,8);
 assert.equal(calculate([interval('steps',8000,'2024-01-01T01:00Z','2024-01-01T02:00Z',{recordingMethod:'manual'})]).entitledCoins,0);
});
test('multiple habits reward participation, not vital readings; walking workouts do not double earn',()=>{
 const rows=[interval('steps',8000,'2024-01-01T01:00Z','2024-01-01T02:00Z'),interval('workout',30,'2024-01-01T01:00Z','2024-01-01T01:30Z',{activityType:'walking'}),{metricType:'heart_rate',value:70},{metricType:'weight',value:65},{metricType:'water_checkin',value:1},{metricType:'water_checkin',value:1},{metricType:'sleep_checkin',value:1},interval('meditation',5,'2024-01-01T03:00Z','2024-01-01T03:05Z')];
 assert.equal(calculate(rows).entitledCoins,13);rows.push(interval('workout',20,'2024-01-01T04:00Z','2024-01-01T04:20Z',{activityType:'cycling'}));assert.equal(calculate(rows).entitledCoins,18);assert.equal(calculate(rows,{...RULES,dailyCap:10}).entitledCoins,10);
});
