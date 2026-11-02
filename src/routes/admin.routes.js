const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const { AppError } = require('../middleware/error.middleware');
const env = require('../config/env');
const users = require('../models/user.model');
const query = require('../services/admin-query.service');
const wallet = require('../models/wallet.model');
const rewardModel = require('../models/reward.model');
const audit = require('../models/audit.model');
const { successResponse } = require('../utils/response');
const { authLimiter, adminWriteLimiter } = require('../middleware/rate-limit.middleware');
router.use(authenticate);
router.use((req,res,next)=>env.adminEmails.includes(req.user.email.toLowerCase()) ? next() : next(new AppError('Admin access required',403)));
const coinRules=require('../services/coin-rules.service');
router.get('/coin-rules',async(req,res,next)=>{try{const {page,limit}=query.buildQuery('users',req.query);successResponse(res,200,'Coin rule versions',await coinRules.list(page,limit));}catch(error){next(error);}});
router.post('/coin-rules',adminWriteLimiter,async(req,res,next)=>{try{successResponse(res,201,'New coin rule version scheduled',await coinRules.create(req.body,req.user.id));}catch(error){next(error);}});
router.get('/overview',async(req,res,next)=>{try{successResponse(res,200,'Admin overview',await query.overview());}catch(error){next(error);}});
for(const kind of ['users','records','devices']) router.get(`/${kind}`,async(req,res,next)=>{try{successResponse(res,200,`Admin ${kind}`,await query.list(kind,req.query));}catch(error){next(error);}});
router.get('/rewards',async(req,res,next)=>{try{
  const page=Number(req.query.page||1),limit=Number(req.query.limit||20);
  if(!Number.isInteger(page)||page<1||!Number.isInteger(limit)||limit<1||limit>100)throw new AppError('Invalid pagination parameters',400);
  let items,total;
  if(env.useMongoDB){const [rows,count]=await Promise.all([rewardModel.Reward.find().sort({createdAt:-1,_id:-1}).skip((page-1)*limit).limit(limit).lean(),rewardModel.Reward.countDocuments()]);items=rows.map(rewardModel.toReward);total=count;}
  else {const rows=await rewardModel.listAllRewards();total=rows.length;items=rows.slice((page-1)*limit,page*limit);}
  successResponse(res,200,'Admin rewards',{items,total,page,limit,totalPages:Math.ceil(total/limit)});
}catch(error){next(error);}});
function rewardPayload(body, partial=false){
  const payload={};
  for(const field of ['title','description','provider','terms','status']) if(body?.[field]!==undefined)payload[field]=body[field];
  for(const field of ['pointsRequired','stock']) if(body?.[field]!==undefined)payload[field]=Number(body[field]);
  for(const field of ['startAt','endAt']) if(body?.[field]!==undefined)payload[field]=body[field] ? new Date(body[field]) : null;
  if(!partial&&!payload.title)throw new AppError('Reward title is required',400);
  if(payload.title!==undefined&&(typeof payload.title!=='string'||!payload.title.trim()||payload.title.trim().length>100))throw new AppError('Reward title must be 1 to 100 characters',400);
  if(payload.description!==undefined&&(typeof payload.description!=='string'||payload.description.length>1000))throw new AppError('Description must be at most 1000 characters',400);
  if(payload.provider!==undefined&&(typeof payload.provider!=='string'||payload.provider.length>100))throw new AppError('Provider must be at most 100 characters',400);
  if(payload.terms!==undefined&&(typeof payload.terms!=='string'||payload.terms.length>3000))throw new AppError('Terms must be at most 3000 characters',400);
  if(payload.pointsRequired!==undefined&&(!Number.isSafeInteger(payload.pointsRequired)||payload.pointsRequired<1||payload.pointsRequired>100000000))throw new AppError('pointsRequired must be a positive whole number',400);
  if(payload.stock!==undefined&&(!Number.isSafeInteger(payload.stock)||payload.stock<0||payload.stock>10000000))throw new AppError('stock must be a non-negative whole number',400);
  if(payload.status!==undefined&&!['ACTIVE','INACTIVE','EXPIRED'].includes(payload.status))throw new AppError('Invalid reward status',400);
  for(const field of ['startAt','endAt'])if(payload[field]&&!Number.isFinite(+payload[field]))throw new AppError(`Invalid ${field}`,400);
  if(payload.title)payload.title=payload.title.trim();
  return payload;
}
router.post('/rewards',adminWriteLimiter,async(req,res,next)=>{try{const reward=await rewardModel.createReward(rewardPayload(req.body));await audit.createAuditLog({userId:req.user.id,action:'ADMIN_REWARD_CREATED',metadata:{rewardId:reward.id,title:reward.title},requestId:req.requestId});successResponse(res,201,'Reward created',{reward});}catch(error){next(error);}});
router.patch('/rewards/:id',adminWriteLimiter,async(req,res,next)=>{try{const reward=await rewardModel.updateReward(req.params.id,rewardPayload(req.body,true));if(!reward)throw new AppError('Reward not found',404);await audit.createAuditLog({userId:req.user.id,action:'ADMIN_REWARD_UPDATED',metadata:{rewardId:reward.id,changes:Object.keys(req.body||{})},requestId:req.requestId});successResponse(res,200,'Reward updated',{reward});}catch(error){next(error);}});
router.get('/redemptions',async(req,res,next)=>{try{
  const page=Number(req.query.page||1),limit=Number(req.query.limit||20);
  if(!Number.isInteger(page)||page<1||!Number.isInteger(limit)||limit<1||limit>100)throw new AppError('Invalid pagination parameters',400);
  let rows,total;
  if(env.useMongoDB){[rows,total]=await Promise.all([rewardModel.Redemption.find().sort({createdAt:-1,_id:-1}).skip((page-1)*limit).limit(limit).populate('rewardId','title').lean(),rewardModel.Redemption.countDocuments()]);
    const ids=[...new Set(rows.map(row=>String(row.userId)))];const userRows=await users.User.find({_id:{$in:ids}}).select('name email publicId').lean();const byId=new Map(userRows.map(u=>[String(u._id),u]));
    rows=rows.map(row=>({...rewardModel.toRedemption({...row,rewardId:row.rewardId?._id||row.rewardId}),rewardTitle:row.rewardId?.title||'Reward',user:byId.has(String(row.userId))?{id:String(row.userId),name:byId.get(String(row.userId)).name,email:byId.get(String(row.userId)).email,publicId:byId.get(String(row.userId)).publicId}:null}));
  }else{const all=await rewardModel.listAllRedemptions();total=all.length;const pageRows=all.slice((page-1)*limit,page*limit);const userRows=await users.listUsers();const byId=new Map(userRows.map(user=>[String(user.id),user]));rows=pageRows.map(row=>({...row,user:byId.has(String(row.userId))?{id:String(row.userId),name:byId.get(String(row.userId)).name,email:byId.get(String(row.userId)).email,publicId:byId.get(String(row.userId)).publicId}:null}));}
  successResponse(res,200,'Admin reward redemptions',{items:rows,total,page,limit,totalPages:Math.ceil(total/limit)});
}catch(error){next(error);}});
async function findUser(id) {
  const user=await users.findUserById(id);
  if(!user)throw new AppError('User not found',404);
  return user;
}
router.get('/users/:id',async(req,res,next)=>{
  try{
    const user=await findUser(req.params.id);
    const [points,records,devices]=await Promise.all([wallet.findWallet(user.id),query.list('records',{userId:user.id,limit:1}),query.list('devices',{userId:user.id,limit:1})]);
    successResponse(res,200,'User details',{user,wallet:points,recordCount:records.total,deviceCount:devices.total,canChangeStatus:user.id!==req.user.id&&!env.adminEmails.includes(user.email.toLowerCase())});
  }catch(error){next(error);}
});
router.get('/users/:id/steps',async(req,res,next)=>{try{const user=await findUser(req.params.id);successResponse(res,200,'Date-wise steps',await require('../services/step-history.service').history(user.id,req.query));}catch(error){next(error);}});
router.get('/users/:id/settlements',async(req,res,next)=>{
  try { const user=await findUser(req.params.id); const {page,limit}=query.buildQuery('records',req.query); successResponse(res,200,'Daily settlement history',await require('../services/daily-settlement.service').history(user.id,page,limit,req.query)); }
  catch(error){next(error);}
});
router.get('/users/:id/transactions',async(req,res,next)=>{
 try {
  const user=await findUser(req.params.id);const {page,limit}=query.buildQuery('users',req.query);
  let items,total;
  if(env.useMongoDB){const [rows,count]=await Promise.all([wallet.WalletTransaction.find({userId:user.id}).sort({createdAt:-1,_id:-1}).skip((page-1)*limit).limit(limit).lean(),wallet.WalletTransaction.countDocuments({userId:user.id})]);items=rows.map(wallet.toTransaction);total=count;}
  else {const rows=await wallet.getTransactionsByUserId(user.id);total=rows.length;items=rows.slice((page-1)*limit,page*limit);}
  successResponse(res,200,'User coin ledger',{items,total,page,limit,totalPages:Math.ceil(total/limit)});
 }catch(error){next(error);}
});
router.get('/users/:id/daily',async(req,res,next)=>{try{const user=await findUser(req.params.id);successResponse(res,200,'Daily coins',await require('../services/daily-settlement.service').progress(user.id,req.query.day));}catch(error){next(error);}});
router.post('/users/:id/activities',adminWriteLimiter,async(req,res,next)=>{
 try {
  const user=await findUser(req.params.id);
  if(user.status!=='ACTIVE')throw new AppError('User is not active',409);
  const {metricType,value,day,startTime,endTime,activityType,note,entryId}=req.body||{};
  coinRules.validDay(day);
  if(!['steps','workout','meditation','water_checkin','sleep_checkin'].includes(metricType))throw new AppError('Unsupported daily activity',400);
  if(typeof note!=='string'||!note.trim()||note.length>500)throw new AppError('An entry reason is required (max 500 characters)',400);
  if(typeof entryId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(entryId))throw new AppError('A unique entryId is required',400);
  if(['steps','workout','meditation'].includes(metricType)&&(!startTime||!endTime))throw new AppError('Activity start and end times are required',400);
  const payload={metricType,value,unit:metricType==='steps'?'count':['workout','meditation'].includes(metricType)?'min':'checkin',
   recordedAt:startTime||`${day}T00:00:00+05:30`,source:'app',sourceRecordId:`admin:${req.user.id}:${entryId}`,sourceVersion:1,
   recordingMethod:'manual',dataOrigin:'admin.entry',...(startTime?{startTime,endTime}:{}),...(metricType==='workout'?{activityType}:{}),
   metadata:{adminEntered:true,enteredBy:req.user.id,note:note.trim()}};
  if(require('../services/daily-rules').dayKey(payload.recordedAt)!==day)throw new AppError('Start time must match the selected IST day',400);
  const result=await require('../services/health.service').createRecord(user.id,payload,req.requestId);
  successResponse(res,result.duplicate?200:201,'Activity recorded; coins follow daily settlement',result);
 }catch(error){next(error);}
});
router.get('/settlements/status',async(req,res,next)=>{
  try { const {DailyActivity,memoryDays}=require('../models/daily-activity.model');
    const counts=env.useMongoDB?await DailyActivity.aggregate([{$group:{_id:'$state',count:{$sum:1}}}]):Object.entries([...memoryDays.values()].reduce((out,row)=>{out[row.state]=(out[row.state]||0)+1;return out;},{})).map(([state,count])=>({_id:state,count}));
    successResponse(res,200,'Settlement worker status',{enabled:env.settlementEnabled&&env.useMongoDB,timezone:'Asia/Kolkata',batchSize:20,concurrency:2,counts});
  }catch(error){next(error);}
});
router.patch('/users/:id/status',authLimiter,async(req,res,next)=>{
  try{
    const {status}=req.body || {};
    if(!['ACTIVE','SUSPENDED'].includes(status))throw new AppError('Status must be ACTIVE or SUSPENDED',400);
    const user=await findUser(req.params.id);
    if(user.id===req.user.id||env.adminEmails.includes(user.email.toLowerCase()))throw new AppError('Admin accounts cannot be suspended here',403);
    const updated=await users.updateStatus(user.id,status);
    await audit.createAuditLog({userId:req.user.id,action:'ADMIN_USER_STATUS_CHANGED',metadata:{targetUserId:user.id,previousStatus:user.status,status},requestId:req.requestId});
    successResponse(res,200,'User status updated',{user:updated});
  }catch(error){next(error);}
});
module.exports=router;
