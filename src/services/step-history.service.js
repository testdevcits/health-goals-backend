const mongoose=require('mongoose');
const env=require('../config/env');
const health=require('../models/health.model');
const {buildQuery}=require('./admin-query.service');
const {dayKey,dayEnd,calculate}=require('./daily-rules');
const {DailyActivity}=require('../models/daily-activity.model');
async function history(userId,params={}){
 const {page,limit,query}=buildQuery('records',params);
 let days,total,records,settlements=[];
 if(env.useMongoDB){
  const match={userId:new mongoose.Types.ObjectId(userId),metricType:'steps',deleted:{$ne:true},...(query.recordedAt?{recordedAt:query.recordedAt}:{})};
  const dayFilter={};if(params.from)dayFilter.$gte=params.from;if(params.to)dayFilter.$lte=params.to;
  const [result]=await health.HealthRecord.aggregate([{$match:match},{$project:{value:1,day:{$ifNull:['$activityDate',{$dateToString:{date:'$recordedAt',format:'%Y-%m-%d',timezone:'Asia/Kolkata'}}]}}},...(Object.keys(dayFilter).length?[{$match:{day:dayFilter}}]:[]),{$group:{_id:'$day',reportedSteps:{$sum:'$value'},recordCount:{$sum:1}}},{$sort:{_id:-1}},{$facet:{items:[{$skip:(page-1)*limit},{$limit:limit}],total:[{$count:'count'}]}}]);
  days=result.items.map(r=>({day:r._id,reportedSteps:r.reportedSteps,recordCount:r.recordCount}));total=result.total[0]?.count||0;
  if(days.length){
   const keys=days.map(d=>d.day);const low=keys[keys.length-1],high=keys[0];
   [records,settlements]=await Promise.all([
    health.HealthRecord.find({...match,recordedAt:{$gte:new Date(+dayEnd(low)-86400000),$lt:dayEnd(high)}}).select('metricType value source recordedAt activityDate startTime endTime dataOrigin recordingMethod').lean(),
    DailyActivity.find({userId,day:{$in:keys}}).select('day rules totals creditedCoins state').lean()
   ]);
  }else records=[];
 }else{
  records=(await health.listAdmin()).filter(r=>String(r.userId)===userId&&r.metricType==='steps'&&!r.deleted);
  const grouped=new Map();for(const r of records){const day=r.activityDate||dayKey(r.recordedAt);if((params.from&&day<params.from)||(params.to&&day>params.to))continue;const row=grouped.get(day)||{day,reportedSteps:0,recordCount:0};row.reportedSteps+=r.value;row.recordCount++;grouped.set(day,row);}
  const all=[...grouped.values()].sort((a,b)=>b.day.localeCompare(a.day));total=all.length;days=all.slice((page-1)*limit,page*limit);
  settlements=[...require('../models/daily-activity.model').memoryDays.values()].filter(r=>r.userId===userId);
 }
 const grouped=new Map();for(const record of records){const day=record.activityDate||dayKey(record.recordedAt);if(!grouped.has(day))grouped.set(day,[]);grouped.get(day).push(record);}
 return {items:days.map(row=>{const saved=settlements.find(r=>r.day===row.day);const totals=calculate(grouped.get(row.day)||[],saved?.rules);return {...row,countedSteps:totals.steps,stepCoinEntitlement:totals.breakdown.steps,dailyCreditedCoins:saved?.creditedCoins||0,state:saved?.state||'LEGACY'};}),total,page,limit,totalPages:Math.ceil(total/limit),timezone:'Asia/Kolkata'};
}
module.exports={history};
