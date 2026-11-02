const {test}=require('node:test');
const assert=require('node:assert/strict');
process.env.USE_MONGODB='false';process.env.JWT_SECRET='test-coins';process.env.JWT_REFRESH_SECRET='test-refresh';
const rules=require('../src/services/coin-rules.service');
const {RULES,calculate}=require('../src/services/daily-rules');
const daily=require('../src/services/daily-settlement.service');
const health=require('../src/services/health.service');
const users=require('../src/models/user.model');
const wallet=require('../src/models/wallet.model');
const fields=()=>Object.fromEntries(rules.fields.map(key=>[key,RULES[key]]));
const now=new Date('2020-01-02T10:00:00Z');
test('append-only rule versions preserve old days, snapshots, late syncs and wallet credits',async()=>{
 const user=await users.createUser({name:'Coin test',email:'coin-rules@example.test',passwordHash:'test'});
 const steps=(day,id,value)=>({metricType:'steps',value,unit:'count',source:'health_connect',sourceRecordId:id,recordedAt:`${day}T07:00:00+05:30`,startTime:`${day}T07:00:00+05:30`,endTime:`${day}T08:00:00+05:30`,dataOrigin:'test.phone',recordingMethod:'automatic'});
 await health.createRecord(user.id,steps('2020-01-02','old',4000));
 await daily.processBatch();assert.equal((await wallet.findWallet(user.id)).availablePoints,4);
 const created=await rules.create({baseVersion:RULES.version,rules:{...fields(),stepTierCoins:3},note:'New step rewards'},user.id,now);
 assert.equal(created.effectiveFrom,'2020-01-03');
 assert.equal((await rules.forDay('2020-01-02')).stepTierCoins,2);
 assert.equal((await rules.forDay('2020-01-03')).stepTierCoins,3);
 // Late data on an old day keeps its saved version, even after a new rule exists.
 await health.createRecord(user.id,steps('2020-01-02','old',6000)); // duplicate
 await health.createRecord(user.id,{...steps('2020-01-02','old',6000),sourceVersion:2});
 await daily.processBatch();assert.equal((await wallet.findWallet(user.id)).availablePoints,6);
 const old=await daily.progress(user.id,'2020-01-02');assert.equal(old.ruleVersion,RULES.version);assert.equal(old.rules.stepTierCoins,2);
 // Newly created historical days also select the rule effective on their activity date.
 await health.createRecord(user.id,steps('2020-01-01','backfill',4000));
 assert.equal((await daily.progress(user.id,'2020-01-01')).rules.version,RULES.version);
 await health.createRecord(user.id,steps('2020-01-03','new',4000));
 assert.equal((await daily.progress(user.id,'2020-01-03')).entitledCoins,6);
 const pending=await daily.history(user.id,1,20,{from:'2020-01-03',to:'2020-01-03'});
 assert.equal(pending.total,1);assert.equal(pending.items[0].pendingCoins,6);
 await daily.processBatch();assert.equal((await wallet.findWallet(user.id)).availablePoints,16);
 const before=await wallet.findWallet(user.id);
 const latest=await rules.create({baseVersion:created.version,rules:{...fields(),stepTierCoins:7},note:'Another version'},user.id,new Date('2020-01-03T18:29:59Z'));
 assert.equal(latest.effectiveFrom,'2020-01-04');
 assert.equal((await daily.progress(user.id,'2020-01-03')).entitledCoins,6);
 assert.equal((await wallet.findWallet(user.id)).availablePoints,before.availablePoints);
 const versions=await rules.list(1,20,new Date('2020-01-03T10:00:00Z'));
 assert.equal(versions.total,2);assert.equal(versions.items[1].rules.stepTierCoins,3);assert.equal(versions.current.stepTierCoins,3);
 await assert.rejects(()=>rules.create({baseVersion:created.version,rules:fields(),note:'Stale save'},user.id,now),/Reload/);
 await assert.rejects(()=>rules.create({baseVersion:latest.version,rules:{...fields(),stepsPerTier:0},note:'Invalid'},user.id,now),/stepsPerTier/);
 await assert.rejects(()=>rules.create({baseVersion:latest.version,rules:{...fields(),stepTierCoins:1.5},note:'Invalid'},user.id,now),/stepTierCoins/);
 await assert.rejects(()=>rules.create({baseVersion:latest.version,rules:fields(),note:''},user.id,now),/reason/);
 assert.equal(calculate([{metricType:'water_checkin',value:1}],{...RULES,waterCheckinCoins:10,dailyCap:3}).entitledCoins,3);
});
