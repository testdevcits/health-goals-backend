const {test}=require('node:test');
const assert=require('node:assert/strict');
process.env.USE_MONGODB='false';process.env.JWT_SECRET='test';process.env.JWT_REFRESH_SECRET='test-refresh';
const rules=require('../src/services/reward-rule.service');
const {analytics,period}=require('../src/services/reward-analytics.service');
const users=require('../src/models/user.model');
const health=require('../src/models/health.model');
test('periods use IST and Monday-based weeks',()=>{
 assert.deepEqual(period({period:'MONTHLY'},new Date('2026-10-31T20:00:00Z')),{start:'2026-11-01',end:'2026-11-30'});
 assert.deepEqual(period({period:'WEEKLY'},new Date('2026-11-03T08:00:00Z')),{start:'2026-11-02',end:'2026-11-08'});
});
test('analytics includes zero activity and excludes deleted and out-of-period activity',async()=>{
 const user=await users.createUser({name:'Chart member',email:'chart@example.test',passwordHash:'test'});
 const rule=await rules.create({title:'Chart target',audience:'INDIVIDUAL',metric:'STEPS',targetValue:1000},user.id);
 const record={id:'analytics-record',userId:user.id,metricType:'steps',value:1500,source:'health_connect',dataOrigin:'phone',recordingMethod:'automatic',recordedAt:'2026-11-02T08:00:00Z',startTime:'2026-11-02T07:00:00Z',endTime:'2026-11-02T08:00:00Z'};
 health.healthRecords.push(record,{...record,deleted:true,value:10000},{...record,recordedAt:'2026-10-02T08:00:00Z',startTime:'2026-10-02T07:00:00Z',endTime:'2026-10-02T08:00:00Z'});
 const result=await analytics(rule.id,new Date('2026-11-03T08:00:00Z'));
 const row=result.participants.find(row=>row.id===user.id);assert.equal(row.value,1500);assert.equal(row.progress,150);assert.equal(result.achieved,1);
});
test('group chart compares matching group goals and excludes different targets',async()=>{
 const community=require('../src/models/community.model');
 for(const id of ['chart-g1','chart-g2','chart-g3'])community.memoryGroups.push({id,name:id,maxMembers:50,members:[]});
 const base={title:'Chart group one',ruleType:'LEADERBOARD',audience:'GROUP',metric:'STEPS',targetValue:100000,period:'MONTHLY'};
 const first=await rules.create({...base,targetGroupId:'chart-g1'},'admin');
 await rules.create({...base,title:'Chart group two',targetGroupId:'chart-g2'},'admin');
 await rules.create({...base,title:'Different goal',targetGroupId:'chart-g3',targetValue:200000},'admin');
 const result=await analytics(first.id,new Date('2026-11-03T08:00:00Z'));
 assert.equal(result.total,2);assert.deepEqual(result.participants.map(row=>row.id),['chart-g1','chart-g2']);assert.ok(result.participants.every(row=>row.rank===1));
});
