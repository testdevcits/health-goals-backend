const crypto=require('crypto');
const mongoose=require('mongoose');
const env=require('../config/env');
const {DailyActivity,memoryDays}=require('../models/daily-activity.model');
const health=require('../models/health.model');
const wallet=require('../models/wallet.model');
const users=require('../models/user.model');
const {RULES,dayKey,dayEnd,calculate}=require('./daily-rules');
const coinRules=require('./coin-rules.service');
const key=(userId,day)=>`${userId}:${day}`;
async function enqueue(userId,day,session=null) {
 const dueAt=dayEnd(day),now=new Date();
 const rules=await coinRules.forDay(day,session);
 if(env.useMongoDB){
  await DailyActivity.updateOne({userId,day},{$inc:{revision:1},$set:{state:'PENDING',nextAttemptAt:now,lastError:null},$setOnInsert:{userId,day,rules,dueAt}}, {upsert:true,session});
 }else{
  const id=key(userId,day);const row=memoryDays.get(id)||{_id:id,userId,day,rules:{...rules},dueAt,revision:0,settledRevision:0,creditedCoins:0,attempts:0,lockUntil:new Date(0)};
  Object.assign(row,{revision:row.revision+1,state:'PENDING',nextAttemptAt:now,lastError:null});memoryDays.set(id,row);
 }
}
async function claim(now=new Date()) {
 const leaseToken=crypto.randomUUID(),lockUntil=new Date(+now+120000);
 if(env.useMongoDB)return DailyActivity.findOneAndUpdate({state:{$in:['PENDING','RETRY','PROCESSING']},dueAt:{$lte:now},nextAttemptAt:{$lte:now},lockUntil:{$lte:now},$expr:{$gt:['$revision','$settledRevision']}},{$set:{state:'PROCESSING',leaseToken,lockUntil},$inc:{attempts:1}},{sort:{dueAt:1,_id:1},new:true}).lean();
 const row=[...memoryDays.values()].sort((a,b)=>a.dueAt-b.dueAt).find(r=>r.revision>r.settledRevision&&r.dueAt<=now&&r.nextAttemptAt<=now&&r.lockUntil<=now);
 if(!row)return null;Object.assign(row,{leaseToken,lockUntil,state:'PROCESSING',attempts:row.attempts+1});return {...row};
}
async function settle(job,now=new Date()) {
 const run=async session=>{
  const row=env.useMongoDB?await DailyActivity.findOne({_id:job._id,leaseToken:job.leaseToken}).session(session).lean():memoryDays.get(job._id);
  if(!row||row.leaseToken!==job.leaseToken)return null;
  const user=env.useMongoDB?await users.User.findById(row.userId).session(session).lean():await users.findUserById(row.userId);
  if(!user||user.status!=='ACTIVE')throw new Error('User unavailable or suspended');
  const records=env.useMongoDB?await health.HealthRecord.find({userId:row.userId,activityDate:row.day,deleted:{$ne:true}}).select('metricType value source startTime endTime dataOrigin recordingMethod activityType').session(session).lean():health.healthRecords.filter(r=>r.user_id===row.userId&&r.activityDate===row.day&&!r.deleted).map(health.toHealthRecord);
  const totals=calculate(records,row.rules);
  // Upward-only credits preserve spent coins when source data is corrected down.
  // Keep the corrected entitlement and original ledger visible for reconciliation.
  const delta=Math.max(0,totals.entitledCoins-row.creditedCoins);
  if(delta>0)await wallet.createTransaction({userId:row.userId,type:'EARN',amount:delta,referenceType:'DAILY_SETTLEMENT',referenceId:`${row.day}:${row.rules.version}`,description:`Daily activities ${row.day} (${row.rules.timezone})`,idempotencyKey:`daily:${row.userId}:${row.day}:${row.rules.version}:${row.creditedCoins+delta}`},session);
  const values={totals,entitledCoins:totals.entitledCoins,creditedCoins:row.creditedCoins+delta,settledRevision:row.revision,state:'SETTLED',lastSettledAt:now,lastError:null,lockUntil:new Date(0),leaseToken:null};
  if(env.useMongoDB)await DailyActivity.updateOne({_id:row._id,leaseToken:job.leaseToken},{$set:values},{session});
  else Object.assign(row,values);
  return {day:row.day,credited:delta,...values};
 };
 return env.useMongoDB?mongoose.connection.transaction(run):run(null);
}
async function retry(job,error,now=new Date()) {
 const seconds=Math.min(3600,Math.pow(2,Math.min(job.attempts,10))*15);
 const values={state:'RETRY',lockUntil:new Date(0),leaseToken:null,nextAttemptAt:new Date(+now+seconds*1000),lastError:'Settlement failed; retry scheduled'};
 if(env.useMongoDB)await DailyActivity.updateOne({_id:job._id,leaseToken:job.leaseToken},{$set:values});
 else {const row=memoryDays.get(job._id);if(row?.leaseToken===job.leaseToken)Object.assign(row,values);}
 console.error('Daily settlement retry:',String(job._id),error.code || error.name);
}
async function processBatch({now=new Date(),batchSize=20,concurrency=2}={}) {
 batchSize=Math.min(20,Math.max(1,batchSize));concurrency=Math.min(2,Math.max(1,concurrency));
 let claimed=0,settled=0,failed=0;
 // At most 20 jobs (therefore at most 20 users), only 2 running concurrently.
 for(let offset=0;offset<batchSize;offset+=concurrency){
  const jobs=[];for(let i=0;i<Math.min(concurrency,batchSize-offset);i++){const job=await claim(now);if(job)jobs.push(job);}
  if(!jobs.length)break;claimed+=jobs.length;
  await Promise.all(jobs.map(async job=>{try{await settle(job,now);settled++;}catch(error){failed++;await retry(job,error,now);}}));
 }
 return {claimed,settled,failed};
}
function publicDay(row,records){const totals=records?calculate(records,row.rules):row.totals;return {day:row.day,timezone:row.rules.timezone,ruleVersion:row.rules.version,rules:row.rules,state:row.state,dueAt:row.dueAt,creditedCoins:row.creditedCoins,entitledCoins:totals?.entitledCoins??row.entitledCoins??0,pendingCoins:Math.max(0,(totals?.entitledCoins??row.entitledCoins??0)-row.creditedCoins),totals,lastSettledAt:row.lastSettledAt,needsSettlement:row.revision>row.settledRevision};}
async function progress(userId,day=dayKey(new Date())){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||Number.isNaN(+new Date(day))||new Date(day).toISOString().slice(0,10)!==day)throw new (require('../middleware/error.middleware').AppError)('Invalid day',400);
 const row=env.useMongoDB?await DailyActivity.findOne({userId,day}).lean():memoryDays.get(key(userId,day));
 if(!row)return {day,timezone:RULES.timezone,rules:await coinRules.forDay(day),state:'NO_DATA',creditedCoins:0,entitledCoins:0,pendingCoins:0};
 const records=env.useMongoDB?await health.HealthRecord.find({userId,activityDate:day,deleted:{$ne:true}}).select('metricType value source startTime endTime dataOrigin recordingMethod activityType').lean():health.healthRecords.filter(r=>r.user_id===userId&&r.activityDate===day&&!r.deleted).map(health.toHealthRecord);
 return publicDay(row,records);
}
async function history(userId,page=1,limit=20,params={}){
 const dayFilter={};if(params.from)dayFilter.$gte=params.from;if(params.to)dayFilter.$lte=params.to;
 const filter={userId,...(Object.keys(dayFilter).length?{day:dayFilter}:{})};
 let rows,total;
 if(env.useMongoDB){[rows,total]=await Promise.all([DailyActivity.find(filter).sort({day:-1}).skip((page-1)*limit).limit(limit).lean(),DailyActivity.countDocuments(filter)]);}
 else{const all=[...memoryDays.values()].filter(r=>r.userId===userId&&(!params.from||r.day>=params.from)&&(!params.to||r.day<=params.to)).sort((a,b)=>b.day.localeCompare(a.day));rows=all.slice((page-1)*limit,page*limit);total=all.length;}
 const pending=rows.filter(r=>r.revision>r.settledRevision).map(r=>r.day);
 let records=[];
 if(pending.length)records=env.useMongoDB
  ?await health.HealthRecord.find({userId,activityDate:{$in:pending},deleted:{$ne:true}}).select('activityDate metricType value source startTime endTime dataOrigin recordingMethod activityType').lean()
  :health.healthRecords.filter(r=>r.user_id===userId&&pending.includes(r.activityDate)&&!r.deleted).map(health.toHealthRecord);
 return {items:rows.map(r=>publicDay(r,pending.includes(r.day)?records.filter(record=>record.activityDate===r.day):undefined)),total,page,limit,totalPages:Math.ceil(total/limit)};
}

module.exports={enqueue,claim,settle,retry,processBatch,progress,history};
