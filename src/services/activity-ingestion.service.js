const mongoose=require('mongoose');
const env=require('../config/env');
const health=require('../models/health.model');
const daily=require('./daily-settlement.service');
const {dayKey}=require('./daily-rules');
const {REWARD_METRICS}=require('./health-metrics');
const {AppError}=require('../middleware/error.middleware');
const revisionSchema=new mongoose.Schema({recordId:mongoose.Schema.Types.ObjectId,userId:mongoose.Schema.Types.ObjectId,sourceVersion:Number,snapshot:mongoose.Schema.Types.Mixed},{timestamps:{createdAt:true,updatedAt:false}});
revisionSchema.index({recordId:1,sourceVersion:1},{unique:true});
const HealthRevision=mongoose.model('HealthRevision',revisionSchema);
const memoryRevisions=[];
function extraFields(payload){
 if(!Number.isFinite(+new Date(payload.startTime||payload.recordedAt)))throw new AppError('Invalid activity timestamp',400);
 const extra={activityDate:dayKey(payload.startTime||payload.recordedAt),sourceVersion:payload.sourceVersion??1,deleted:payload.deleted??false};
 if(payload.metadata?.aggregationScope==='health_connect'&&(payload.source!=='health_connect'||payload.metricType!=='steps'||payload.metadata.aggregation!=='daily_total'||payload.sourceRecordId!==`daily-steps:${extra.activityDate}:aggregate`))throw new AppError('Invalid aggregated steps identity',400);
 if(!Number.isSafeInteger(extra.sourceVersion)||extra.sourceVersion<1||typeof extra.deleted!=='boolean')throw new AppError('Invalid sourceVersion or deleted flag',400);
 for(const field of ['dataOrigin','recordingMethod','activityType'])if(payload[field]!==undefined){if(typeof payload[field]!=='string'||!payload[field]||payload[field].length>200)throw new AppError(`Invalid ${field}`,400);extra[field]=payload[field];}
 if(extra.recordingMethod&&!['automatic','active','manual'].includes(extra.recordingMethod))throw new AppError('Invalid recordingMethod',400);
 if(payload.startTime||payload.endTime){
  const start=new Date(payload.startTime),end=new Date(payload.endTime);
  if(!payload.startTime||!payload.endTime||!Number.isFinite(+start)||!Number.isFinite(+end)||end<=start||end>Date.now()+300000)throw new AppError('Valid startTime and endTime are required',400,{hasStartTime:Boolean(payload.startTime),hasEndTime:Boolean(payload.endTime),validStartTime:Number.isFinite(+start),validEndTime:Number.isFinite(+end),endAfterStart:Number.isFinite(+start)&&Number.isFinite(+end)?end>start:false});
  if(dayKey(start)!==dayKey(new Date(+end-1)))throw new AppError('Split activity intervals at midnight Asia/Kolkata before syncing',400);
  if(dayKey(payload.recordedAt)!==dayKey(start))throw new AppError('recordedAt must belong to the activity day',400);
  extra.startTime=start;extra.endTime=end;
 }
 if(['workout','meditation'].includes(payload.metricType)){
  if(!extra.startTime||payload.unit!=='min')throw new AppError('Workout/meditation require an interval and unit min',400);
  if(payload.metricType==='workout'&&!['walking','running','hiking','treadmill','cycling','yoga','strength','swimming','other'].includes(extra.activityType))throw new AppError('A supported activityType is required for workout',400);
 }
 if(payload.metricType==='steps'&&(payload.unit!=='count'||!Number.isSafeInteger(Number(payload.value))))throw new AppError('Steps require integer count',400);
 if(['water_checkin','sleep_checkin'].includes(payload.metricType)&&(Number(payload.value)!==1||payload.unit!=='checkin'))throw new AppError('Habit check-ins require value 1 and unit checkin',400);
 return extra;
}
// Health Connect aggregation is already deduplicated across source apps. Keep
// one current snapshot per day while retaining superseded rows for inspection.
async function supersedeStepSnapshots(userId,payload,extra,session){
 if(payload.source!=='health_connect'||payload.metricType!=='steps'||payload.metadata?.aggregationScope!=='health_connect'||payload.metadata?.aggregation!=='daily_total')return;
 const day=extra.activityDate;
 if(payload.sourceRecordId!==`daily-steps:${day}:aggregate`)throw new AppError('Invalid aggregated steps identity',400);
 const isSnapshot=row=>row.sourceRecordId!==payload.sourceRecordId && (
  row.sourceRecordId?.startsWith(`daily-steps:${day}:`) ||
  row.sourceRecordId===`health_connect:steps:ist:${day}` ||
  row.sourceRecordId?.startsWith(`health_connect:steps:ist:${day}:`));
 if(env.useMongoDB){
  const rows=await health.HealthRecord.find({userId,metricType:'steps',source:'health_connect',activityDate:day,deleted:{$ne:true}}).session(session);
  for(const row of rows){if(!isSnapshot(row))continue;
   await HealthRevision.create([{recordId:row._id,userId,sourceVersion:row.sourceVersion||1,snapshot:health.toHealthRecord(row)}],{session});
   row.deleted=true;row.sourceVersion=(row.sourceVersion||1)+1;await row.save({session});
  }
 }else{
  for(const row of health.healthRecords){const record=health.toHealthRecord(row);
   if(String(record.userId)!==String(userId)||record.metricType!=='steps'||record.source!=='health_connect'||record.activityDate!==day||record.deleted||!isSnapshot(record))continue;
   memoryRevisions.push(record);row.deleted=true;row.sourceVersion=(row.sourceVersion||1)+1;
  }
 }
}
function assertSourceIdentity(existing,payload,extra=extraFields(payload)){
 if(!existing)return;
 const old=existing.toObject?health.toHealthRecord(existing):existing;
 if(old.metricType!==payload.metricType||(old.activityDate||dayKey(old.recordedAt))!==extra.activityDate)throw new AppError('An updated source record cannot change metric or activity day',409);
}
function isLegacyStepSnapshot(payload,day){
 return payload.source==='health_connect'&&payload.metricType==='steps'&&payload.sourceRecordId!==`daily-steps:${day}:aggregate`&&(
  payload.sourceRecordId.startsWith(`daily-steps:${day}:`)||payload.sourceRecordId===`health_connect:steps:ist:${day}`||payload.sourceRecordId.startsWith(`health_connect:steps:ist:${day}:`));
}
async function ingest(userId,payload,existingSession=null,options={}){
 const extra=extraFields(payload);
 const run=async session=>{
  const existing=Object.hasOwn(options,'existingRecord')?options.existingRecord:env.useMongoDB?await health.HealthRecord.findOne({userId,source:payload.source,sourceRecordId:payload.sourceRecordId}).session(session):await health.findBySourceRecord(userId,payload.source,payload.sourceRecordId);
  if(existing)assertSourceIdentity(existing,payload,extra);
  if(isLegacyStepSnapshot(payload,extra.activityDate)){
   const canonicalId=`daily-steps:${extra.activityDate}:aggregate`;
   const canonical=env.useMongoDB?await health.HealthRecord.findOne({userId,source:'health_connect',sourceRecordId:canonicalId}).session(session):await health.findBySourceRecord(userId,'health_connect',canonicalId);
   // A legacy client cannot replace a newer canonical snapshot, including its tombstone.
   if(canonical)return {record:env.useMongoDB?health.toHealthRecord(canonical):canonical,duplicate:true,superseded:true,rewards:[],settlementPending:false};
  }

  if(existing){
   const old=env.useMongoDB?health.toHealthRecord(existing):existing;
   if(extra.sourceVersion<=(old.sourceVersion||1))return {record:old,duplicate:true,rewards:[],settlementPending:REWARD_METRICS.has(payload.metricType)};
   if(env.useMongoDB){await HealthRevision.create([{recordId:existing._id,userId,sourceVersion:old.sourceVersion,snapshot:old}],{session});existing.set({value:Number(payload.value),unit:payload.unit,deviceId:payload.deviceId||old.deviceId||null,recordedAt:payload.recordedAt,metadata:payload.metadata||{},...extra});await existing.save({session});}
   else{memoryRevisions.push(old);const row=health.healthRecords.find(r=>r.id===old.id);Object.assign(row,{value:Number(payload.value),unit:payload.unit,device_id:payload.deviceId||old.deviceId||null,recorded_at:new Date(payload.recordedAt).toISOString(),metadata:payload.metadata||{},...extra});}
   await supersedeStepSnapshots(userId,payload,extra,session);
   if(options.enqueue!==false&&REWARD_METRICS.has(payload.metricType))await daily.enqueue(userId,extra.activityDate,session);
   return {record:env.useMongoDB?health.toHealthRecord(existing):await health.findBySourceRecord(userId,payload.source,payload.sourceRecordId),duplicate:false,updated:true,rewards:[],settlementPending:REWARD_METRICS.has(payload.metricType)};
  }
  const record=await health.createHealthRecord({userId,metricType:payload.metricType,value:Number(payload.value),unit:payload.unit,recordedAt:payload.recordedAt,source:payload.source,sourceRecordId:payload.sourceRecordId,deviceId:payload.deviceId||null,metadata:payload.metadata||{},...extra},session);
  await supersedeStepSnapshots(userId,payload,extra,session);
  if(options.enqueue!==false&&REWARD_METRICS.has(payload.metricType))await daily.enqueue(userId,extra.activityDate,session);
  return {record,duplicate:false,rewards:[],settlementPending:REWARD_METRICS.has(payload.metricType)};
 };
 // Retry insert races once; the winning record is then found as a duplicate.
 if(existingSession)return run(existingSession);
 try{return env.useMongoDB?await mongoose.connection.transaction(run):await run(null);}
 catch(error){if(error.code===11000)return env.useMongoDB?mongoose.connection.transaction(run):run(null);throw error;}
}
module.exports={ingest,extraFields,assertSourceIdentity,HealthRevision,memoryRevisions};
