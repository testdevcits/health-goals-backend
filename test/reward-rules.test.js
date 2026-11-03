const {test}=require('node:test');
const assert=require('node:assert/strict');
process.env.USE_MONGODB='false';
process.env.JWT_SECRET='test-reward';
process.env.JWT_REFRESH_SECRET='test-refresh';
const rules=require('../src/services/reward-rule.service');
const base={title:'Monthly steps',audience:'INDIVIDUAL',metric:'STEPS',targetValue:100000};
test('duplicate goals are rejected on create and edit, including renamed or paused rules',async()=>{
 const first=await rules.create(base,'admin');
 await assert.rejects(rules.create({...base,title:'Renamed goal'},'admin'),/already exists/);
 await rules.update(first.id,{status:'INACTIVE'},'admin');
 await assert.rejects(rules.create(base,'admin'),/already exists/);
 const second=await rules.create({...base,targetValue:200000},'admin');
 await assert.rejects(rules.update(second.id,{targetValue:100000},'admin'),/already exists/);
 const updated=await rules.update(second.id,{title:'Updated name'},'admin');
 assert.equal(updated.title,'Updated name');
 assert.equal((await rules.list()).total,2);
});
test('concurrent identical creates save only one rule',async()=>{
 const results=await Promise.allSettled([rules.create({...base,targetValue:300000},'admin'),rules.create({...base,targetValue:300000},'admin')]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 assert.match(results.find(result=>result.status==='rejected').reason.message,/already exists/);
});
test('deletion removes the rule and allows the same configuration to be recreated',async()=>{
 const input={...base,targetValue:456789};
 const rule=await rules.create(input,'admin');
 assert.equal((await rules.remove(rule.id)).id,rule.id);
 assert.equal(await rules.remove(rule.id),null);
 assert.ok(!(await rules.list()).items.some(item=>item.id===rule.id));
 assert.ok((await rules.create(input,'admin')).id);
});
