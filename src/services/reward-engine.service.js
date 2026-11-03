const mongoose=require('mongoose');
const env=require('../config/env');
const rules=require('./reward-rule.service');
const health=require('../models/health.model');
const wallet=require('../models/wallet.model');
const {calculate,dayKey,dayEnd}=require('./daily-rules');
const {period}=require('./reward-analytics.service');
const schema=new mongoose.Schema({key:{type:String,unique:true},ruleId:String,start:String,end:String,rule:mongoose.Schema.Types.Mixed,participants:[mongoose.Schema.Types.Mixed],rows:[mongoose.Schema.Types.Mixed],finalizedAt:Date},{timestamps:true});
const awardSchema=new mongoose.Schema({key:{type:String,unique:true},userId:{type:String,index:true},runKey:String,title:String,ruleTitle:String,points:Number,groupId:String,awardedAt:Date});
const Run=mongoose.model('RewardRun',schema),Award=mongoose.model('RuleAchievement',awardSchema);
const memoryRuns=new Map(),memoryAwards=new Map();
async function runs(){return env.useMongoDB?Run.find().lean():[...memoryRuns.values()];}
async function achievements(userId){return env.useMongoDB?Award.find({userId:String(userId)}).sort({awardedAt:-1}).lean():[...memoryAwards.values()].filter(row=>row.userId===String(userId));}
async function snapshot(rule,now){
 const window=period(rule,now),key=`${rule.id}:${window.start}`;
 let existing=env.useMongoDB?await Run.findOne({key}).lean():memoryRuns.get(key);if(existing)return existing;
 const options=await rules.options();const active=options.users.filter(row=>row.status==='ACTIVE');
 let participants=active.filter(row=>!rule.targetUserId||row.id===rule.targetUserId).map(row=>({id:row.id,name:row.name,userIds:[row.id]}));
 if(rule.audience==='GROUP'){const group=options.groups.find(row=>row.id===rule.targetGroupId);participants=group?[{id:group.id,name:group.name,userIds:group.members.filter(row=>row.status==='ACTIVE').map(row=>row.id)}]:[];}
 const value={key,ruleId:rule.id,...window,rule,participants,rows:[]};
 if(env.useMongoDB){try{return await Run.findOneAndUpdate({key},{$setOnInsert:value},{upsert:true,new:true}).lean();}catch(error){if(error.code===11000)return Run.findOne({key}).lean();throw error;}}
 memoryRuns.set(key,value);return value;
}
async function progress(run,now){
 const start=new Date(`${run.start}T00:00:00+05:30`),end=dayEnd(run.end);
 const ids=[...new Set(run.participants.flatMap(row=>row.userIds))];
 const records=env.useMongoDB?await health.HealthRecord.find({userId:{$in:ids},recordedAt:{$gte:start,$lt:end,$lte:now},deleted:{$ne:true}}).lean():health.healthRecords.map(health.toHealthRecord);
 const days=new Map();
 for(const row of records){const id=String(row.userId),day=row.activityDate||dayKey(row.recordedAt);if(!ids.includes(id)||row.deleted||day<run.start||day>run.end||new Date(row.recordedAt)>now)continue;const key=`${id}:${day}`;if(!days.has(key))days.set(key,{id,records:[]});days.get(key).records.push(row);}
 const totals=new Map();for(const {id,records:rows} of days.values()){const value=calculate(rows),amount=run.rule.metric==='STEPS'?value.steps:run.rule.metric==='WORKOUT_HOURS'?value.workoutMinutes/60:value.meditationMinutes/60;totals.set(id,(totals.get(id)||0)+amount);}
 let rank=0,previous;
 return run.participants.map(row=>({...row,value:row.userIds.reduce((sum,id)=>sum+(totals.get(id)||0),0)})).sort((a,b)=>b.value-a.value||a.id.localeCompare(b.id)).map((row,index)=>{if(row.value!==previous)rank=index+1;previous=row.value;return {...row,rank,progress:row.value/run.rule.targetValue*100,achieved:row.value>=run.rule.targetValue};});
}
async function award(run,row,now){
 for(const userId of row.userIds){
 const key=`${run.key}:${row.id}:${userId}`;
 const value={key,userId,runKey:run.key,title:run.rule.badgeTitle||run.rule.title,ruleTitle:run.rule.title,points:run.rule.bonusPoints||0,groupId:run.rule.audience==='GROUP'?row.id:null,awardedAt:now};
 if(env.useMongoDB){await mongoose.connection.transaction(async session=>{
 if(await Award.exists({key}).session(session))return;
 if(value.points)await wallet.createTransaction({userId,type:'BONUS',amount:value.points,referenceType:'REWARD_RULE',referenceId:run.key,description:run.rule.title,idempotencyKey:`rule:${key}`},session);
 await Award.create([value],{session});
 });}else{if(memoryAwards.has(key))continue;memoryAwards.set(key,value);try{if(value.points)await wallet.createTransaction({userId,type:'BONUS',amount:value.points,referenceType:'REWARD_RULE',referenceId:run.key,description:run.rule.title,idempotencyKey:`rule:${key}`});}catch(error){memoryAwards.delete(key);throw error;}}
 }
}
let pending=null;
async function evaluate(now=new Date()){
 if(pending)return pending;
 pending=(async()=>{
 const definitions=(await rules.list()).items.filter(row=>row.status==='ACTIVE');
 for(const rule of definitions)await snapshot(rule,now);
 const activeIds=new Set(definitions.map(row=>row.id));
 for(const run of await runs()){
 if(run.finalizedAt||!activeIds.has(run.ruleId)||dayKey(now)<run.start)continue;
 const rows=await progress(run,now),closed=now>=dayEnd(run.end);
 for(const row of rows){if(row.achieved&&(run.rule.ruleType!=='LEADERBOARD'||closed&&row.rank<=(run.rule.winnersCount||1)))await award(run,row,now);}
 const update={rows,...(closed?{finalizedAt:now}:{})};
 if(env.useMongoDB)await Run.updateOne({key:run.key},{$set:update});else Object.assign(run,update);
 }
 })().finally(()=>{pending=null;});return pending;
}
async function forUser(userId){
 const allRuns=await runs();
 const history=allRuns.filter(run=>run.participants.some(row=>row.userIds.includes(String(userId))));
 const active=new Set((await rules.list()).items.filter(rule=>rule.status==='ACTIVE').map(rule=>rule.id));
 for(const run of history){
  if(run.rule.audience!=='GROUP')continue;
  const comparable=allRuns.filter(other=>other.rule.audience==='GROUP'&&other.start===run.start&&other.end===run.end&&other.rule.ruleType===run.rule.ruleType&&other.rule.metric===run.rule.metric&&other.rule.targetValue===run.rule.targetValue);
  const groups=new Map();for(const other of comparable)for(const row of other.rows||[])if(!groups.has(row.id)||groups.get(row.id).value<row.value)groups.set(row.id,row);
  let rank=0,previous;
  const combined=[...groups.values()].sort((a,b)=>b.value-a.value||a.id.localeCompare(b.id)).map((row,index)=>{if(row.value!==previous)rank=index+1;previous=row.value;return {...row,rank};});
  // Comparison rank is a display statistic; per-rule winner awards remain separate.
  const index=history.findIndex(item=>item.key===run.key);history[index]={...run,rows:combined};
 }
 return {competitions:history.map(run=>({id:run.key,title:run.rule.title,ruleType:run.rule.ruleType,audience:run.rule.audience,metric:run.rule.metric,targetValue:run.rule.targetValue,start:run.start,end:run.end,status:run.finalizedAt?'FINAL':active.has(run.ruleId)?'LIVE':'PAUSED',leaderboard:(run.rows||[]).slice(0,20).map(({userIds,...row})=>row),myProgress:(run.rows||[]).filter(row=>row.userIds.includes(String(userId))).map(({userIds,...row})=>row)})),achievements:await achievements(userId)};
}
module.exports={Run,Award,evaluate,forUser,progress,snapshot,achievements};
