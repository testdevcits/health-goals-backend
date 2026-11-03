const {test}=require('node:test');
const assert=require('node:assert/strict');
process.env.USE_MONGODB='false';process.env.JWT_SECRET='test';process.env.JWT_REFRESH_SECRET='test-refresh';
const {seedDefaults}=require('../scripts/seed-reward-rules');
test('one seed creates all three types, then updates the same IDs even after renaming',async()=>{
 const rows=[{_id:'legacy',title:'Monthly Steps Challenge',ruleType:'LEADERBOARD',audience:'INDIVIDUAL',targetGroupId:null}];
 const service={RewardRule:{findOne:query=>({lean:async()=>rows.find(row=>Object.entries(query).every(([key,value])=>value&&typeof value==='object'?row[key]===undefined:row[key]===value))}),updateOne:async(query,update)=>Object.assign(rows.find(row=>row._id===query._id),update.$set)},create:async body=>{const row={...body,_id:String(rows.length+1)};rows.push(row);return {...row,id:row._id};},update:async(id,body)=>{const row=rows.find(row=>row._id===id);Object.assign(row,body);return {...row,id};}};
 const first=await seedDefaults('admin',service);
 rows[0].title='Renamed';rows[1].targetValue=999;
 const second=await seedDefaults('admin',service);
 assert.deepEqual(second,first);assert.equal(rows.length,3);assert.equal(rows[0]._id,'legacy');assert.equal(rows[1].targetValue,100000);assert.equal(rows[2].durationDays,7);assert.equal(rows[2].period,'DURATION');assert.equal(rows[2].targetValue,50000);assert.deepEqual(rows.map(row=>row.ruleType),['LEADERBOARD','BADGE','CHALLENGE']);
});

test('group defaults cover all three types with stable identities per group',()=>{
 const {groupDefaults}=require('../scripts/seed-reward-rules');
 const definitions=groupDefaults([{id:'group-1',name:'Walkers'},{id:'group-2',name:'Runners'}]);
 assert.equal(definitions.length,6);
 assert.equal(new Set(definitions.map(row=>row.seedKey)).size,6);
 assert.ok(definitions.every(row=>row.audience==='GROUP'&&row.targetGroupId));
 assert.deepEqual(definitions.slice(0,3).map(row=>row.ruleType),['LEADERBOARD','BADGE','CHALLENGE']);
 assert.equal(groupDefaults([{id:'group-1',name:'New name'}])[0].seedKey,definitions[0].seedKey);
 assert.deepEqual(groupDefaults([]),[]);
});
