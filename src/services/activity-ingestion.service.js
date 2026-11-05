const mongoose=require('mongoose');
const env=require('../config/env');
const health=require('../models/health.model');
const daily=require('./daily-settlement.service');
const {dayKey}=require('./daily-rules');
const {AppError}=require('../middleware/error.middleware');
const revisionSchema=new mongoose.Schema({recordId:mongoose.Schema.Types.ObjectId,userId:mongoose.Schema.Types.ObjectId,sourceVersion:Number,snapshot:mongoose.Schema.Types.Mixed},{timestamps:{createdAt:true,updatedAt:false}});
revisionSchema.index({recordId:1,sourceVersion:1},{unique:true});
const HealthRevision=mongoose.model('HealthRevision',revisionSchema);
const memoryRevisions=[];
function extraFields(payload){
 const extra={activityDate:dayKey(payload.startTime||payload.recordedAt),sourceVersion:payload.sourceVersion??1,deleted:payload.deleted??false};
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
async function ingest(userId,payload,existingSession=null){
 const extra=extraFields(payload);
 const run=async session=>{
  const existing=env.useMongoDB?await health.HealthRecord.findOne({userId,source:payload.source,sourceRecordId:payload.sourceRecordId}).session(session):await health.findBySourceRecord(userId,payload.source,payload.sourceRecordId);
  if(existing){
   const old=env.useMongoDB?health.toHealthRecord(existing):existing;
   if(extra.sourceVersion<=(old.sourceVersion||1))return {record:old,duplicate:true,rewards:[],settlementPending:true};
   if(old.metricType!==payload.metricType||(old.activityDate||dayKey(old.recordedAt))!==extra.activityDate)throw new AppError('An updated source record cannot change metric or activity day',409);
   if(env.useMongoDB){await HealthRevision.create([{recordId:existing._id,userId,sourceVersion:old.sourceVersion,snapshot:old}],{session});existing.set({value:Number(payload.value),unit:payload.unit,recordedAt:payload.recordedAt,metadata:payload.metadata||{},...extra});await existing.save({session});}
   else{memoryRevisions.push(old);const row=health.healthRecords.find(r=>r.id===old.id);Object.assign(row,{value:Number(payload.value),unit:payload.unit,metadata:payload.metadata||{},...extra});}
   await daily.enqueue(userId,extra.activityDate,session);
   return {record:env.useMongoDB?health.toHealthRecord(existing):await health.findBySourceRecord(userId,payload.source,payload.sourceRecordId),duplicate:false,updated:true,rewards:[],settlementPending:true};
  }
  const record=await health.createHealthRecord({userId,metricType:payload.metricType,value:Number(payload.value),unit:payload.unit,recordedAt:payload.recordedAt,source:payload.source,sourceRecordId:payload.sourceRecordId,deviceId:payload.deviceId||null,metadata:payload.metadata||{},...extra},session);
  await daily.enqueue(userId,extra.activityDate,session);
  return {record,duplicate:false,rewards:[],settlementPending:true};
 };
 // Retry insert races once; the winning record is then found as a duplicate.
 if(existingSession)return run(existingSession);
 try{return env.useMongoDB?await mongoose.connection.transaction(run):await run(null);}
 catch(error){if(error.code===11000)return env.useMongoDB?mongoose.connection.transaction(run):run(null);throw error;}
}
module.exports={ingest,extraFields,HealthRevision,memoryRevisions};
