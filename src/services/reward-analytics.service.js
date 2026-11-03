const env=require('../config/env');
const rules=require('./reward-rule.service');
const health=require('../models/health.model');
const {calculate,dayKey}=require('./daily-rules');
const {AppError}=require('../middleware/error.middleware');
function period(rule,now){
 const today=dayKey(now),date=new Date(`${today}T00:00:00Z`);
 if(rule.period==='DURATION'){const start=rule.startDate||dayKey(rule.createdAt);return {start,end:new Date(new Date(`${start}T00:00:00Z`).getTime()+(rule.durationDays-1)*86400000).toISOString().slice(0,10)};}
 if(rule.period==='WEEKLY'){date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);const start=date.toISOString().slice(0,10);date.setUTCDate(date.getUTCDate()+6);return {start,end:date.toISOString().slice(0,10)};}
 return {start:today.slice(0,7)+'-01',end:new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).toISOString().slice(0,10)};
}
async function analytics(id,now=new Date()){
 const rule=(await rules.list()).items.find(row=>row.id===id);if(!rule)throw new AppError('Reward rule not found',404);
 const window=period(rule,now),targets=await rules.options();
 const records=env.useMongoDB?await health.HealthRecord.find({deleted:{$ne:true},$or:[{activityDate:{$gte:window.start,$lte:window.end}},{activityDate:{$exists:false},recordedAt:{$gte:new Date(`${window.start}T00:00:00+05:30`),$lt:new Date(new Date(`${window.end}T00:00:00+05:30`).getTime()+86400000)}}]}).lean():health.healthRecords.map(health.toHealthRecord);
 const days=new Map();
 for(const record of records){const day=record.activityDate||dayKey(record.recordedAt);if(record.deleted||day<window.start||day>window.end||new Date(record.recordedAt)>now)continue;const key=`${record.userId}:${day}`;if(!days.has(key))days.set(key,{userId:String(record.userId),records:[]});days.get(key).records.push(record);}
 const totals=new Map();for(const {userId,records:rows} of days.values()){const value=calculate(rows);const amount=rule.metric==='STEPS'?value.steps:rule.metric==='WORKOUT_HOURS'?value.workoutMinutes/60:value.meditationMinutes/60;totals.set(userId,(totals.get(userId)||0)+amount);}
 const active=targets.users.filter(user=>user.status==='ACTIVE');
 let participants=active.filter(user=>!rule.targetUserId||user.id===rule.targetUserId).map(user=>({id:user.id,name:user.name,value:totals.get(user.id)||0}));
 if(rule.audience==='GROUP'){
  const definitions=(await rules.list()).items;
  const groupIds=new Set(definitions.filter(other=>{const dates=period(other,now);return other.audience==='GROUP'&&other.ruleType===rule.ruleType&&other.metric===rule.metric&&other.targetValue===rule.targetValue&&dates.start===window.start&&dates.end===window.end;}).map(other=>other.targetGroupId));
  participants=targets.groups.filter(group=>groupIds.has(group.id)).map(group=>({id:group.id,name:group.name,value:group.members.filter(member=>member.status==='ACTIVE').reduce((sum,member)=>sum+(totals.get(member.id)||0),0)}));
 }
 participants.sort((a,b)=>b.value-a.value||a.name.localeCompare(b.name));let rank=0,previous;
 participants=participants.map((row,index)=>{if(row.value!==previous)rank=index+1;previous=row.value;return {...row,rank,progress:row.value/rule.targetValue*100,achieved:row.value>=rule.targetValue};});
 return {rule,period:window,timezone:'Asia/Kolkata',generatedAt:now.toISOString(),total:participants.length,achieved:participants.filter(row=>row.achieved).length,started:participants.filter(row=>row.value>0).length,participants:participants.slice(0,20)};
}
module.exports={analytics,period};
