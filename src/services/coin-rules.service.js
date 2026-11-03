const crypto = require('crypto');
const mongoose = require('mongoose');
const env = require('../config/env');
const { RULES, dayKey, dayEnd } = require('./daily-rules');
const { AppError } = require('../middleware/error.middleware');
const fields = ['dailyCap','stepsPerTier','stepTierCoins','stepMaxCoins','workoutMinutes','workoutCoins','meditationMinutes','meditationCoins','waterCheckinCoins','sleepCheckinCoins'];
const schema = new mongoose.Schema({
 version: { type: String, required: true, unique: true },
 parentVersion: { type: String, required: true, unique: true },
 effectiveFrom: { type: String, required: true, index: true },
 rules: { type: mongoose.Schema.Types.Mixed, required: true },
 createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
 note: { type: String, required: true }
}, { timestamps: { createdAt: true, updatedAt: false } });
schema.index({ effectiveFrom: -1, createdAt: -1, _id: -1 });
const CoinRuleVersion = mongoose.model('CoinRuleVersion', schema);
const memoryVersions = [];
const baseline = () => ({version:RULES.version,effectiveFrom:'0001-01-01',rules:{...RULES},note:'Original daily point rules',createdAt:null});
function validDay(day) {
 if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(+new Date(day))||new Date(day).toISOString().slice(0,10)!==day) throw new AppError('Invalid day',400);
}
async function forDay(day, session = null) {
 validDay(day);
 const saved = env.useMongoDB
  ? await CoinRuleVersion.findOne({effectiveFrom:{$lte:day}}).sort({effectiveFrom:-1,createdAt:-1,_id:-1}).session(session).lean()
  : [...memoryVersions].reverse().find(row=>row.effectiveFrom<=day);
 return {...(saved?.rules || RULES)};
}
async function list(page=1,limit=20,now=new Date()) {
 const today=dayKey(now);
 const [items,total,current] = await Promise.all([
  env.useMongoDB ? CoinRuleVersion.find().sort({createdAt:-1,_id:-1}).skip((page-1)*limit).limit(limit).lean() : Promise.resolve([...memoryVersions].reverse().slice((page-1)*limit,page*limit)),
  env.useMongoDB ? CoinRuleVersion.countDocuments({}) : Promise.resolve(memoryVersions.length),
  forDay(today)
 ]);
 const latest = env.useMongoDB ? await CoinRuleVersion.findOne().sort({createdAt:-1,_id:-1}).lean() : memoryVersions.at(-1);
 return {items,total,page,limit,totalPages:Math.ceil(total/limit),current,latest:latest||baseline(),baseline:baseline(),nextEffectiveFrom:dayKey(dayEnd(today))};
}
async function create(payload,adminId,now=new Date()) {
 if(!payload||typeof payload!=='object'||Array.isArray(payload)) throw new AppError('Point rules are required',400);
 const {rules,note,baseVersion}=payload;
 if(!rules||typeof rules!=='object'||Array.isArray(rules)||Object.keys(rules).some(key=>!fields.includes(key))) throw new AppError('Provide supported point rule fields only',400);
 for(const field of fields) {
  const max=['stepsPerTier'].includes(field)?200000:['workoutMinutes','meditationMinutes'].includes(field)?1440:100000;
  const min=['stepsPerTier','workoutMinutes','meditationMinutes'].includes(field)?1:0;
  if(!Number.isSafeInteger(rules[field])||rules[field]<min||rules[field]>max) throw new AppError(`${field} must be an integer between ${min} and ${max}`,400);
 }
 if(typeof note!=='string'||!note.trim()||note.trim().length>500) throw new AppError('A change reason (1–500 characters) is required',400);
 const latest=env.useMongoDB?await CoinRuleVersion.findOne().sort({createdAt:-1,_id:-1}).lean():memoryVersions.at(-1);
 if(baseVersion!==(latest?.version||RULES.version)) throw new AppError('Point rules changed. Reload before saving a new version.',409);
 const version=`daily-${crypto.randomUUID()}`;
 const entry={version,parentVersion:baseVersion,effectiveFrom:dayKey(dayEnd(dayKey(now))),rules:{...rules,version,timezone:RULES.timezone},createdBy:adminId,note:note.trim(),createdAt:now};
 try {
  if(env.useMongoDB) return (await CoinRuleVersion.create(entry)).toObject();
  // No await between the conflict check and append in temporary storage.
  memoryVersions.push(entry);return structuredClone(entry);
 } catch(error) {if(error.code===11000)throw new AppError('Point rules changed. Reload before saving a new version.',409);throw error;}
}
module.exports={CoinRuleVersion,forDay,list,create,fields,validDay};
