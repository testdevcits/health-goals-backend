const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const { AppError } = require('../middleware/error.middleware');
const env = require('../config/env');
const users = require('../models/user.model');
const query = require('../services/admin-query.service');
const wallet = require('../models/wallet.model');
const rewardModel = require('../models/reward.model');
const audit = require('../models/audit.model');
const partnerModel = require('../models/partner.model');
const { successResponse } = require('../utils/response');
const { authLimiter, adminWriteLimiter } = require('../middleware/rate-limit.middleware');
const bcrypt = require('bcrypt');
router.use(authenticate);
router.use((req,res,next)=>{
  const configuredAdmin=env.adminEmails.includes(req.user.email.toLowerCase());
  req.adminRole=configuredAdmin?'ADMIN':req.user.role;
  return ['ADMIN','SUB_ADMIN'].includes(req.adminRole) ? next() : next(new AppError('Admin access required',403));
});
const fullAdminOnly=(req,res,next)=>req.adminRole==='ADMIN'?next():next(new AppError('Only full administrators can manage this setting',403));
const defaultSubAdminPermissions=['users:read','records:read','devices:read','challenges:read','activity:import','data:export'];
const permissionForRequest=req=>{
  if(req.path==='/data-export'&&req.method==='GET')return 'data:export';
  if(req.path==='/activity-import'&&req.method==='POST')return 'activity:import';
  if(req.method==='GET'&&/^\/users(\/|$)/.test(req.path))return 'users:read';
  if(req.method==='GET'&&/^\/records(\/|$)/.test(req.path))return 'records:read';
  if(req.method==='GET'&&/^\/devices(\/|$)/.test(req.path))return 'devices:read';
  if(req.method==='GET'&&/^\/challenges(\/|$)/.test(req.path))return 'challenges:read';
  if(req.method==='GET'&&req.path==='/overview')return 'users:read';
  return null;
};
router.use(async(req,res,next)=>{try{
  if(req.adminRole!=='SUB_ADMIN')return next();
  const user=await users.findUserById(req.user.id);const permissions=user?.adminPermissions==null?defaultSubAdminPermissions:user.adminPermissions;
  const required=permissionForRequest(req);
  return required&&permissions.includes(required)?next():next(new AppError('Sub-admin permission is not granted for this action',403));
}catch(error){next(error);}});
const coinRules=require('../services/coin-rules.service');
const rewardRules=require('../services/reward-rule.service');
router.get('/administrators',fullAdminOnly,async(req,res,next)=>{try{
  const items=await users.listAdministrators();
  const activity=(await audit.listAuditLogs({limit:250})).items;
  const byUser=new Map();
  for(const row of activity){if(row.userId&&!byUser.has(String(row.userId)))byUser.set(String(row.userId),row);}
  successResponse(res,200,'Administrators fetched',{items:items.map(item=>({...item,lastActivity:byUser.get(String(item.id))||null}))});
}catch(error){next(error);}});
router.get('/audit-logs',fullAdminOnly,async(req,res,next)=>{try{
  const {page,limit}=query.buildQuery('users',req.query);let userId;
  if(req.query.userId){const target=await users.findUserById(req.query.userId);if(!target)throw new AppError('User not found',404);userId=target.id;}
  if(req.query.action&&(typeof req.query.action!=='string'||req.query.action.length>100))throw new AppError('action filter must be at most 100 characters',400);
  const dateQuery=query.buildQuery('users',{from:req.query.from,to:req.query.to}).query;
  successResponse(res,200,'Audit logs fetched',await audit.listAuditLogs({userId,action:req.query.action,from:dateQuery.createdAt?.$gte,to:dateQuery.createdAt?.$lte,page,limit}));
}catch(error){next(error);}});
router.get('/analytics',fullAdminOnly,async(req,res,next)=>{try{
  const {query:dateFilter}=query.buildQuery('records',{from:req.query.from,to:req.query.to});
  const from=dateFilter.recordedAt?.$gte,to=dateFilter.recordedAt?.$lte;
  const {User}=users;const {HealthRecord}=require('../models/health.model');const {Redemption}=rewardModel;
  if(env.useMongoDB){
    const userMatch={...(from||to?{createdAt:{...(from?{$gte:from}:{}),...(to?{$lte:to}:{})}}:{})};
    const recordMatch={deleted:{$ne:true},...(from||to?{recordedAt:{...(from?{$gte:from}:{}),...(to?{$lte:to}:{})}}:{})};
    const redemptionMatch={...(from||to?{createdAt:{...(from?{$gte:from}:{}),...(to?{$lte:to}:{})}}:{})};
    const [registrations,records,redemptions,totals]=await Promise.all([
      User.aggregate([{$match:userMatch},{$group:{_id:{$dateToString:{date:'$createdAt',format:'%Y-%m-%d',timezone:'Asia/Kolkata'}},count:{$sum:1}}},{$sort:{_id:1}}]),
      HealthRecord.aggregate([{$match:recordMatch},{$group:{_id:{$dateToString:{date:'$recordedAt',format:'%Y-%m-%d',timezone:'Asia/Kolkata'}},count:{$sum:1}}},{$sort:{_id:1}}]),
      Redemption.aggregate([{$match:redemptionMatch},{$group:{_id:{$dateToString:{date:'$createdAt',format:'%Y-%m-%d',timezone:'Asia/Kolkata'}},count:{$sum:1},pointsUsed:{$sum:'$pointsUsed'}}},{$sort:{_id:1}}]),
      Promise.all([User.countDocuments({}),HealthRecord.countDocuments({deleted:{$ne:true}}),Redemption.countDocuments({})])
    ]);
    return successResponse(res,200,'Admin analytics fetched',{from:req.query.from||null,to:req.query.to||null,timezone:'Asia/Kolkata',totals:{users:totals[0],records:totals[1],redemptions:totals[2]},registrations,records,redemptions});
  }
  const allUsers=await users.listUsers(),allRecords=(await require('../models/health.model').listAdmin()).filter(row=>!row.deleted),allRedemptions=await rewardModel.listAllRedemptions();
  const bucket=(rows,getDate)=>{const map=new Map();for(const row of rows){const time=new Date(getDate(row));if(from&&time<from||to&&time>to)continue;const date=require('../services/daily-rules').dayKey(time);map.set(date,(map.get(date)||0)+1);}return [...map].sort(([a],[b])=>a.localeCompare(b)).map(([_id,count])=>({_id,count}));};
  return successResponse(res,200,'Admin analytics fetched',{from:req.query.from||null,to:req.query.to||null,timezone:'Asia/Kolkata',totals:{users:allUsers.length,records:allRecords.length,redemptions:allRedemptions.length},registrations:bucket(allUsers,row=>row.createdAt||row.created_at),records:bucket(allRecords,row=>row.recordedAt||row.recorded_at),redemptions:bucket(allRedemptions,row=>row.createdAt||row.created_at)});
}catch(error){next(error);}});
router.get('/administrators/:id/activity',fullAdminOnly,async(req,res,next)=>{try{
  const user=await users.findUserById(req.params.id);
  if(!user||!['ADMIN','SUB_ADMIN'].includes(user.role))throw new AppError('Administrator not found',404);
  successResponse(res,200,'Administrator activity fetched',{user,items:(await audit.listAuditLogs({userId:user.id,limit:100})).items});
}catch(error){next(error);}});
router.patch('/administrators/:id/permissions',fullAdminOnly,adminWriteLimiter,async(req,res,next)=>{try{
  const allowed=['users:read','records:read','devices:read','challenges:read','activity:import','data:export'];const permissions=req.body?.permissions;
  if(!Array.isArray(permissions)||permissions.some(permission=>!allowed.includes(permission))||new Set(permissions).size!==permissions.length)throw new AppError('permissions must be a unique list of supported sub-admin permissions',400,{allowed});
  const administrator=await users.updateAdminPermissions(req.params.id,permissions);if(!administrator)throw new AppError('Sub-admin not found',404);
  await audit.createAuditLog({userId:req.user.id,action:'ADMIN_SUB_ADMIN_PERMISSIONS_UPDATED',metadata:{administratorId:administrator.id,permissions},requestId:req.requestId});
  successResponse(res,200,'Sub-admin permissions updated',{administrator});
}catch(error){next(error);}});
router.post('/administrators',fullAdminOnly,adminWriteLimiter,async(req,res,next)=>{try{
  const body=req.body||{};const name=String(body.name||'').trim();const email=String(body.email||'').trim().toLowerCase();const password=String(body.password||'');
  if(name.length<2||name.length>120)throw new AppError('Name must be 2 to 120 characters',400);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new AppError('Enter a valid email address',400);
  if(password.length<8||password.length>72)throw new AppError('Temporary password must be 8 to 72 characters',400);
  if(await users.findUserByEmail(email))throw new AppError('This email already has an account',409);
  const administrator=await users.createUser({name,email,passwordHash:await bcrypt.hash(password,12),role:'SUB_ADMIN'});
  await audit.createAuditLog({userId:req.user.id,action:'ADMIN_SUB_ADMIN_CREATED',metadata:{administratorId:administrator.id,email},requestId:req.requestId});
  successResponse(res,201,'Sub-admin created. They can use the same email OTP login.',{administrator});
}catch(error){next(error);}});
router.get('/data-export',async(req,res,next)=>{try{
  const kind=['users','records','devices'].includes(req.query.kind)?req.query.kind:'records';
  const result=await query.list(kind,{...req.query,page:1,limit:100});
  const columns=kind==='users'?['name','email','publicId','status','role','createdAt']:kind==='devices'?['model','manufacturer','platform','status','lastSyncAt','user']:['metricType','value','unit','recordedAt','source','user'];
  const quote=value=>`"${String(value??'').replace(/"/g,'""')}"`;
  const csv=[columns.join(','),...result.items.map(row=>columns.map(column=>quote(column==='user'?(row.user?.email||row.user?.name||''):row[column])).join(','))].join('\n');
  res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="health-${kind}.csv"`);res.status(200).send(csv);
}catch(error){next(error);}});
router.post('/activity-import',adminWriteLimiter,async(req,res,next)=>{try{
  const items=Array.isArray(req.body?.items)?req.body.items:[];
  if(!items.length||items.length>100)throw new AppError('Upload 1 to 100 activity rows at a time',400);
  const allowed={steps:'count',workout:'min',meditation:'min',water_checkin:'checkin',sleep_checkin:'checkin'};const created=[];
  for(let index=0;index<items.length;index++){
    const row=items[index]||{};const user=await users.findUserById(String(row.userId||''));const metricType=String(row.metricType||'');const value=Number(row.value);const recordedAt=String(row.recordedAt||'');
    if(!user||!allowed[metricType]||!Number.isFinite(value)||value<0||Number.isNaN(Date.parse(recordedAt)))throw new AppError(`Row ${index+1} is invalid`,400);
    const result=await require('../services/health.service').createRecord(user.id,{metricType,value,unit:allowed[metricType],recordedAt,source:'admin_import',sourceRecordId:`import:${req.user.id}:${Date.now()}:${index}`,recordingMethod:'manual',dataOrigin:'admin.import',metadata:{importedBy:req.user.id}},req.requestId);
    if(!result.duplicate)created.push(result.record);
  }
  await audit.createAuditLog({userId:req.user.id,action:'ADMIN_ACTIVITY_IMPORTED',metadata:{rows:items.length,created:created.length},requestId:req.requestId});
  successResponse(res,201,'Activity import completed',{created:created.length});
}catch(error){next(error);}});
router.get('/groups',async(req,res,next)=>{try{successResponse(res,200,'Group activity overview',await require('../models/community.model').groupRankings(req.query.day,true));}catch(error){next(error);}});
router.get('/ticket-rewards/leaderboard',async(req,res,next)=>{try{const month=req.query.month;const audience=String(req.query.audience||'INDIVIDUAL').toUpperCase();const items=await require('../services/ticket-reward.service').leaderboard(month,audience);const claims=await require('../models/ticket-claim.model').list({month});const claimed=new Set(claims.filter(row=>row.audience===audience).map(row=>row.winnerId));successResponse(res,200,'Monthly leaderboard winners',{month,audience,items:items.map(({phone,leaderPhone,...item})=>({...item,claimExists:claimed.has(item.id)}))});}catch(error){next(error);}});
router.get('/ticket-rewards/claims',async(req,res,next)=>{try{const month=req.query.month;if(month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new AppError('month must use YYYY-MM format',400);const items=await require('../models/ticket-claim.model').list({month});await Promise.all(items.filter(item=>!item.contactPhone&&item.recipientUserId).map(async item=>{item.contactPhone=(await users.findUserProfileById(item.recipientUserId))?.phone||'';}));successResponse(res,200,'Leaderboard ticket claim history',{items});}catch(error){next(error);}});
router.post('/ticket-rewards/claims',adminWriteLimiter,async(req,res,next)=>{try{
  const {month,audience,winnerId}=req.body||{};const normalizedAudience=String(audience||'').toUpperCase();
  const rankings=await require('../services/ticket-reward.service').leaderboard(month,normalizedAudience);const winner=rankings.find(item=>item.id===String(winnerId));
  if(!winner)throw new AppError('Winner is not present in the selected month leaderboard',404);
  if(winner.rank!==1)throw new AppError('Only the first-place winner can receive a monthly ticket reward',400);
  const recipientName=normalizedAudience==='GROUP'?winner.leaderName:winner.name;const recipientEmail=normalizedAudience==='GROUP'?winner.leaderEmail:winner.email;
  const contactUser=await users.findUserProfileById(normalizedAudience==='GROUP'?winner.leaderId:winner.id);
  const recipientPhone=contactUser?.phone||'';
  if(!recipientEmail)throw new AppError('Winner email is missing; the ticket cannot be sent',409);
  const claim=await require('../models/ticket-claim.model').create({month,audience:normalizedAudience,winnerId:winner.id,winnerName:winner.name,recipientUserId:normalizedAudience==='GROUP'?winner.leaderId:winner.id,encryptedRecipientPhone:recipientPhone?require('../services/voucher-code.service').encrypt(recipientPhone):null,recipientName,recipientEmail,rank:winner.rank,steps:winner.steps,memberSnapshot:normalizedAudience==='GROUP'?winner.members:[],status:'CONSENT_PENDING',consent:null,bookingReference:'',ticketCount:1,ticketDate:null,ticketNumber:'',encryptedImageData:null,delivery:null,createdBy:req.user.id,updatedBy:req.user.id});
  await audit.createAuditLog({userId:req.user.id,action:'ADMIN_TICKET_REWARD_CLAIM_CREATED',metadata:{claimId:String(claim._id||claim.id),month,audience:normalizedAudience,winnerId:winner.id,rank:winner.rank,steps:winner.steps},requestId:req.requestId});
  successResponse(res,201,'Monthly winner claim created',{claim:require('../models/ticket-claim.model').dto(claim)});
}catch(error){if(error.code===11000)error=new AppError('A ticket claim already exists for this winner and month',409);next(error);}});
router.post('/ticket-rewards/claims/:id/consent',adminWriteLimiter,async(req,res,next)=>{try{
  const body=req.body||{};if(body.confirmed!==true)throw new AppError('Confirm that the winner agreed to the ticket booking terms',400);
  if(!['PHONE','EMAIL','IN_PERSON'].includes(body.method))throw new AppError('method must be PHONE, EMAIL, or IN_PERSON',400);
  const model=require('../models/ticket-claim.model');const current=await model.find(req.params.id);if(!current)throw new AppError('Ticket claim not found',404);
  if(current.status==='SENT')throw new AppError('Consent details cannot be changed after sending',409);
  const savedPhone=current.encryptedRecipientPhone?require('../services/voucher-code.service').decrypt(current.encryptedRecipientPhone):(await users.findUserProfileById(current.recipientUserId))?.phone||'';
  const phone=String(body.phone||savedPhone).trim();const digits=phone.replace(/\D/g,'');if(digits.length<10||digits.length>15)throw new AppError('Winner profile does not have a valid phone number. Add or correct it before recording consent.',400);
  const consent={method:body.method,confirmedAt:new Date(),confirmedBy:req.user.id,termsVersion:'ticket-booking-v1',encryptedPhone:require('../services/voucher-code.service').encrypt(phone),phoneLast4:digits.slice(-4),termsText:'I agree that Health App may use my phone number to book the leaderboard reward ticket and may email the ticket image and booking details to my registered email address.'};
  const updated=await model.update(req.params.id,{consent,status:'READY_TO_SEND',updatedBy:req.user.id});
  await audit.createAuditLog({userId:req.user.id,action:'ADMIN_TICKET_REWARD_CONSENT_RECORDED',metadata:{claimId:req.params.id,method:body.method,phoneLast4:consent.phoneLast4,termsVersion:consent.termsVersion},requestId:req.requestId});
  successResponse(res,200,'Consent recorded',{claim:model.dto(updated)});
}catch(error){next(error);}});
router.post('/ticket-rewards/claims/:id/send',adminWriteLimiter,async(req,res,next)=>{try{
  const model=require('../models/ticket-claim.model');const current=await model.find(req.params.id);if(!current)throw new AppError('Ticket claim not found',404);
  if(!current.consent||current.status==='CONSENT_PENDING')throw new AppError('Record winner consent before sending the ticket',409);
  if(current.status==='SENT')throw new AppError('Ticket email has already been sent for this claim',409);
  const body=req.body||{};const ticketCount=Number(body.ticketCount||1);if(!Number.isInteger(ticketCount)||ticketCount<1||ticketCount>10)throw new AppError('ticketCount must be between 1 and 10',400);
  const ticketDate=String(body.ticketDate||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(ticketDate)||Number.isNaN(Date.parse(`${ticketDate}T00:00:00Z`))||new Date(`${ticketDate}T00:00:00Z`).toISOString().slice(0,10)!==ticketDate)throw new AppError('ticketDate must be a valid YYYY-MM-DD date',400);
  const ticketNumber=String(body.ticketNumber||'').trim();if(!ticketNumber||ticketNumber.length>100)throw new AppError('Enter a ticket or PNR number (up to 100 characters)',400);
  const bookingReference=String(body.bookingReference||'').trim();if(bookingReference.length>120)throw new AppError('bookingReference must be 120 characters or fewer',400);
  const match=String(body.image||'').match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);if(!match)throw new AppError('Attach a PNG, JPEG, or WebP ticket image',400);
  const buffer=Buffer.from(match[2],'base64');if(!buffer.length||buffer.length>5*1024*1024)throw new AppError('Ticket image must be smaller than 5 MB',413);
  const filename=String(body.filename||'ticket').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100)||'ticket';
  const image={buffer,contentType:match[1],filename:/\.(png|jpe?g|webp)$/i.test(filename)?filename:`${filename}.${match[1].split('/')[1]==='jpeg'?'jpg':match[1].split('/')[1]}`};
  const imageSha256=require('crypto').createHash('sha256').update(buffer).digest('hex');
  const delivery={recipientEmail:current.recipientEmail,sentAt:new Date(),sentBy:req.user.id,ticketCount,bookingReference,ticketDate,ticketNumber,filename:image.filename,contentType:image.contentType,imageSha256};
  const encryptedImageData=require('../services/voucher-code.service').encrypt(buffer.toString('base64'));
  await require('../services/mail.service').sendTicketReward({email:current.recipientEmail,winnerName:current.recipientName,month:current.month,ticketCount,bookingReference,image});
  const updated=await model.update(req.params.id,{status:'SENT',bookingReference,ticketCount,ticketDate,ticketNumber,encryptedImageData,delivery,updatedBy:req.user.id});
  await audit.createAuditLog({userId:req.user.id,action:'ADMIN_TICKET_REWARD_EMAIL_SENT',metadata:{claimId:req.params.id,month:current.month,audience:current.audience,recipientEmail:current.recipientEmail,ticketCount,ticketDate,ticketNumber,bookingReference,imageSha256},requestId:req.requestId});
  successResponse(res,200,'Ticket image emailed to the winner',{claim:model.dto(updated)});
}catch(error){next(error);}});
router.get('/coin-rules',async(req,res,next)=>{try{const {page,limit}=query.buildQuery('users',req.query);successResponse(res,200,'Point rule versions',await coinRules.list(page,limit));}catch(error){next(error);}});
router.post('/coin-rules',adminWriteLimiter,async(req,res,next)=>{try{successResponse(res,201,'New point rule version scheduled',await coinRules.create(req.body,req.user.id));}catch(error){next(error);}});
router.get('/reward-rules',async(req,res,next)=>{try{successResponse(res,200,'Reward rules',await rewardRules.list());}catch(error){next(error);}});
router.get('/reward-rules/:id/analytics',async(req,res,next)=>{try{successResponse(res,200,'Reward progress',await require('../services/reward-analytics.service').analytics(req.params.id));}catch(error){next(error);}});
router.get('/reward-rules/options',async(req,res,next)=>{try{successResponse(res,200,'Reward rule targets',await rewardRules.options());}catch(error){next(error);}});
router.get('/challenges',async(req,res,next)=>{try{successResponse(res,200,'Admin challenges',{items:await require('../models/challenge.model').listAdmin()});}catch(error){next(error);}});
router.post('/challenges',adminWriteLimiter,async(req,res,next)=>{try{const item=await require('../services/challenge.service').create(req.body,req.user.id);await audit.createAuditLog({userId:req.user.id,action:'ADMIN_CHALLENGE_CREATED',metadata:{challengeId:item.id,title:item.title,month:item.month},requestId:req.requestId});successResponse(res,201,'Challenge draft created',{challenge:item});}catch(error){next(error);}});
router.patch('/challenges/:id',adminWriteLimiter,async(req,res,next)=>{try{const item=await require('../services/challenge.service').update(req.params.id,req.body,req.user.id);if(!item)throw new AppError('Challenge not found or cannot be edited',404);await audit.createAuditLog({userId:req.user.id,action:'ADMIN_CHALLENGE_UPDATED',metadata:{challengeId:item.id,changes:Object.keys(req.body||{})},requestId:req.requestId});successResponse(res,200,'Challenge updated',{challenge:item});}catch(error){next(error);}});
router.post('/challenges/:id/publish',adminWriteLimiter,async(req,res,next)=>{try{const item=await require('../services/challenge.service').publish(req.params.id,req.user.id);if(!item)throw new AppError('Challenge not found',404);await audit.createAuditLog({userId:req.user.id,action:'ADMIN_CHALLENGE_PUBLISHED',metadata:{challengeId:item.id,title:item.title,month:item.month},requestId:req.requestId});successResponse(res,200,'Challenge published and users notified',{challenge:item});}catch(error){next(error);}});
router.patch('/challenges/:id/status',adminWriteLimiter,async(req,res,next)=>{try{const item=await require('../services/challenge.service').setStatus(req.params.id,req.body?.status,req.user.id);if(!item)throw new AppError('Challenge not found or finalized',404);await audit.createAuditLog({userId:req.user.id,action:'ADMIN_CHALLENGE_STATUS_CHANGED',metadata:{challengeId:item.id,status:item.status},requestId:req.requestId});successResponse(res,200,'Challenge status updated',{challenge:item});}catch(error){next(error);}});
router.post('/challenges/:id/finalize',adminWriteLimiter,async(req,res,next)=>{try{const challengeModel=require('../models/challenge.model');const row=await challengeModel.find(req.params.id);if(!row)throw new AppError('Challenge not found',404);if(new Date(row.endsAt)>new Date())throw new AppError('Challenge can only be finalized after its end date',409);const due=await challengeModel.finalizeDue(new Date(),require('../services/challenge.service').notifyResult);const item=await challengeModel.find(req.params.id);if(!item?.finalizedAt)throw new AppError('Challenge could not be finalized',409);await audit.createAuditLog({userId:req.user.id,action:'ADMIN_CHALLENGE_FINALIZED',metadata:{challengeId:req.params.id,finalized:due.finalized},requestId:req.requestId});successResponse(res,200,'Challenge results finalized',{challenge:challengeModel.dto(item),finalized:due.finalized});}catch(error){next(error);}});
router.post('/reward-rules',adminWriteLimiter,async(req,res,next)=>{try{const rule=await rewardRules.create(req.body,req.user.id);await audit.createAuditLog({userId:req.user.id,action:'ADMIN_REWARD_RULE_CREATED',metadata:{ruleId:rule.id,title:rule.title,audience:rule.audience,metric:rule.metric},requestId:req.requestId});successResponse(res,201,'Reward rule created',rule);}catch(error){next(error);}});
router.patch('/reward-rules/:id',adminWriteLimiter,async(req,res,next)=>{try{const rule=await rewardRules.update(req.params.id,req.body,req.user.id);if(!rule)throw new AppError('Reward rule not found',404);await audit.createAuditLog({userId:req.user.id,action:'ADMIN_REWARD_RULE_UPDATED',metadata:{ruleId:rule.id,changes:Object.keys(req.body||{})},requestId:req.requestId});successResponse(res,200,'Reward rule updated',rule);}catch(error){next(error);}});
router.delete('/reward-rules/:id',adminWriteLimiter,async(req,res,next)=>{try{const rule=await rewardRules.remove(req.params.id);if(!rule)throw new AppError('Reward rule not found',404);await audit.createAuditLog({userId:req.user.id,action:'ADMIN_REWARD_RULE_DELETED',metadata:{ruleId:rule.id,title:rule.title},requestId:req.requestId});successResponse(res,200,'Reward rule deleted',{id:rule.id});}catch(error){next(error);}});
router.get('/overview',async(req,res,next)=>{try{successResponse(res,200,'Admin overview',await query.overview());}catch(error){next(error);}});
router.get('/partners',async(req,res,next)=>{try{successResponse(res,200,'Partners',{items:await partnerModel.list()});}catch(error){next(error);}});
router.get('/partners/:id/summary',async(req,res,next)=>{try{
  const partner=await partnerModel.find(req.params.id);if(!partner)throw new AppError('Partner not found',404);
  const partnerDto=partnerModel.dto(partner);
  const [rewards,submissions,redemptions]=await Promise.all([rewardModel.listAllRewards(),partnerModel.listCoupons(),rewardModel.getPartnerRedemptions(req.params.id)]);
  const partnerRewards=rewards.filter(reward=>String(reward.partnerId||'')===String(req.params.id));
  const userIds=[...new Set((redemptions.items||[]).map(row=>String(row.userId)))];
  const userRows=env.useMongoDB?await users.User.find({_id:{$in:userIds}}).select('name email publicId').lean():await users.listUsers();
  const userById=new Map(userRows.map(user=>[String(user.id||user._id),user]));
  const redemptionItems=(redemptions.items||[]).map(row=>{const user=userById.get(String(row.userId));return {...row,user:user?{id:String(user.id||user._id),name:user.name,email:user.email,publicId:user.publicId}:null};});
  successResponse(res,200,'Partner account summary',{partner:partnerDto,rewards:partnerRewards,submissions:submissions.filter(row=>row.partnerId===String(req.params.id)),redemptions:{...redemptions,items:redemptionItems}});
}catch(error){next(error);}});
router.post('/partners',adminWriteLimiter,async(req,res,next)=>{try{const body=req.body||{};const name=typeof body.name==='string'?body.name.trim():'';const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';if(name.length<2||name.length>100)throw new AppError('Partner name must be 2 to 100 characters',400);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new AppError('Enter a valid partner email',400);const fields=['contactName','category','legalName','businessType','businessAddress','businessIdType','businessIdNumber','verificationNotes','notes'];for(const field of fields)if(body[field]!==undefined&&(typeof body[field]!=='string'||body[field].length>(field==='notes'?2000:['businessAddress'].includes(field)?500:['verificationNotes'].includes(field)?1000:['legalName'].includes(field)?160:['businessIdNumber'].includes(field)?100:field==='category'?80:100)))throw new AppError(`Invalid ${field}`,400);const enums={businessType:['','SOLE_PROPRIETOR','PARTNERSHIP','LLP','PRIVATE_LIMITED','PUBLIC_LIMITED','TRUST','OTHER'],businessIdType:['','GSTIN','UDYAM','CIN','LLPIN','SHOP_LICENSE','OTHER']};for(const [field,allowed] of Object.entries(enums))if(body[field]!==undefined&&!allowed.includes(body[field]))throw new AppError(`Invalid ${field}`,400);if(body.verificationStatus!==undefined&&!['NOT_PROVIDED','PENDING','VERIFIED','REJECTED'].includes(body.verificationStatus))throw new AppError('Invalid verificationStatus',400);const partner=await partnerModel.create({name,email,...Object.fromEntries(fields.map(field=>[field,typeof body[field]==='string'?body[field].trim():undefined]).filter(([,value])=>value!==undefined)),verificationStatus:body.verificationStatus||'NOT_PROVIDED'});await audit.createAuditLog({userId:req.user.id,action:'ADMIN_PARTNER_CREATED',metadata:{partnerId:partner.id,email},requestId:req.requestId});successResponse(res,201,'Partner added for review',{partner});}catch(error){if(error.code===11000)error=new AppError('A partner with this email already exists',409);next(error);}});
router.patch('/partners/:id',adminWriteLimiter,async(req,res,next)=>{try{const current=await partnerModel.find(req.params.id);if(!current)throw new AppError('Partner not found',404);const body=req.body||{},fields={};if(body.status!==undefined){if(!['PENDING','ACTIVE','INACTIVE'].includes(body.status))throw new AppError('Invalid partner status',400);fields.status=body.status;}for(const field of ['name','email','contactName','category','legalName','businessType','businessAddress','businessIdType','businessIdNumber','verificationNotes','notes'])if(body[field]!==undefined){if(typeof body[field]!=='string')throw new AppError(`Invalid ${field}`,400);fields[field]=body[field].trim();}if(fields.name!==undefined&&(fields.name.length<2||fields.name.length>100))throw new AppError('Partner name must be 2 to 100 characters',400);if(fields.email!==undefined&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email))throw new AppError('Enter a valid partner email',400);const maxLengths={contactName:100,category:80,legalName:160,businessAddress:500,businessIdNumber:100,verificationNotes:1000,notes:2000};for(const [field,max] of Object.entries(maxLengths))if(fields[field]!==undefined&&fields[field].length>max)throw new AppError(`Invalid ${field}`,400);const enums={businessType:['','SOLE_PROPRIETOR','PARTNERSHIP','LLP','PRIVATE_LIMITED','PUBLIC_LIMITED','TRUST','OTHER'],businessIdType:['','GSTIN','UDYAM','CIN','LLPIN','SHOP_LICENSE','OTHER']};for(const [field,allowed] of Object.entries(enums))if(fields[field]!==undefined&&!allowed.includes(fields[field]))throw new AppError(`Invalid ${field}`,400);if(body.verificationStatus!==undefined){if(!['NOT_PROVIDED','PENDING','VERIFIED','REJECTED'].includes(body.verificationStatus))throw new AppError('Invalid verificationStatus',400);fields.verificationStatus=body.verificationStatus;}const partner=await partnerModel.update(req.params.id,fields);await audit.createAuditLog({userId:req.user.id,action:'ADMIN_PARTNER_UPDATED',metadata:{partnerId:partner.id,changes:Object.keys(fields)},requestId:req.requestId});successResponse(res,200,'Partner updated',{partner});}catch(error){if(error.code===11000)error=new AppError('A partner with this email already exists',409);next(error);}});
router.post('/partners/:id/portal-credentials',adminWriteLimiter,async(req,res,next)=>{try{const result=await require('../services/partner-portal.service').issueCredentials(req.params.id,req.body?.username);await audit.createAuditLog({userId:req.user.id,action:'ADMIN_PARTNER_PORTAL_CREDENTIALS_ISSUED',metadata:{partnerId:req.params.id,username:result.username},requestId:req.requestId});successResponse(res,201,'Partner portal credentials created. Copy the temporary password now.',{partner:result.partner,username:result.username,temporaryPassword:result.temporaryPassword,loginUrl:`${env.partnerPortalUrl}/partner-portal`});}catch(error){if(error.code===11000)error=new AppError('That partner login ID is already assigned',409);next(error);}});
router.post('/partners/:id/keys',adminWriteLimiter,async(req,res,next)=>{try{const partner=await partnerModel.find(req.params.id);if(!partner)throw new AppError('Partner not found',404);const environment=req.body?.environment;if(!['test','live'].includes(environment))throw new AppError('Environment must be test or live',400);if(environment==='live'&&partner.status!=='ACTIVE')throw new AppError('Approve and activate the partner before issuing a live key',409);if((partner.keys||[]).some(key=>key.environment===environment&&!key.revokedAt))throw new AppError(`An active ${environment} key already exists. Copy the existing key or revoke it before issuing a replacement.`,409);const prefix=environment==='live'?'HK-live-':'HK-test-';const raw=`${prefix}${require('crypto').randomBytes(32).toString('base64url')}`;const hash=require('crypto').createHash('sha256').update(raw).digest('hex');const encryptedSecret=require('../services/voucher-code.service').encrypt(raw);const updated=await partnerModel.addKey(req.params.id,environment,raw,hash,encryptedSecret);if(!updated)throw new AppError(`An active ${environment} key already exists. Copy the existing key or revoke it before issuing a replacement.`,409);await audit.createAuditLog({userId:req.user.id,action:'ADMIN_PARTNER_KEY_ISSUED',metadata:{partnerId:updated.id,environment,prefix:raw.slice(0,11)},requestId:req.requestId});successResponse(res,201,'API key issued. Copy it from the partner details.',{partner:updated});}catch(error){next(error);}});
router.get('/partners/:id/keys/:keyId/secret',async(req,res,next)=>{try{const result=await partnerModel.getKeySecret(req.params.id,req.params.keyId);if(!result.partner)throw new AppError('Partner not found',404);if(!result.apiKey){if(result.legacy)throw new AppError('This older key cannot be copied securely. Revoke it and generate a replacement.',409);throw new AppError('Active API key not found',404);}successResponse(res,200,'API key retrieved for copying',{apiKey:result.apiKey});}catch(error){next(error);}});
router.delete('/partners/:id/keys/:keyId',adminWriteLimiter,async(req,res,next)=>{try{const partner=await partnerModel.revokeKey(req.params.id,req.params.keyId);if(!partner)throw new AppError('API key not found',404);await audit.createAuditLog({userId:req.user.id,action:'ADMIN_PARTNER_KEY_REVOKED',metadata:{partnerId:partner.id,keyId:req.params.keyId},requestId:req.requestId});successResponse(res,200,'API key revoked',{partner});}catch(error){next(error);}});
router.get('/partner-coupons',async(req,res,next)=>{try{successResponse(res,200,'Partner coupon submissions',{items:await partnerModel.listCoupons()});}catch(error){next(error);}});
router.patch('/partner-coupons/:id',adminWriteLimiter,async(req,res,next)=>{try{const status=req.body?.status;if(!['APPROVED','REJECTED'].includes(status))throw new AppError('Status must be APPROVED or REJECTED',400);const coupon=await partnerModel.reviewCoupon(req.params.id,status,req.user.id);if(!coupon)throw new AppError('Coupon not found',404);await audit.createAuditLog({userId:req.user.id,action:'ADMIN_PARTNER_COUPON_REVIEWED',metadata:{couponId:coupon.id,status},requestId:req.requestId});successResponse(res,200,'Partner coupon reviewed',{coupon});}catch(error){next(error);}});
for(const kind of ['users','records','devices']) router.get(`/${kind}`,async(req,res,next)=>{try{successResponse(res,200,`Admin ${kind}`,await query.list(kind,req.query));}catch(error){next(error);}});
router.get('/rewards',async(req,res,next)=>{try{
  const page=Number(req.query.page||1),limit=Number(req.query.limit||20);
  if(!Number.isInteger(page)||page<1||!Number.isInteger(limit)||limit<1||limit>100)throw new AppError('Invalid pagination parameters',400);
  let items,total;
  if(env.useMongoDB){const [rows,count]=await Promise.all([rewardModel.Reward.find().sort({createdAt:-1,_id:-1}).skip((page-1)*limit).limit(limit).lean(),rewardModel.Reward.countDocuments()]);items=await Promise.all(rows.map(async row=>({...rewardModel.toReward(row),availableVoucherCount:await rewardModel.countAvailableVoucherCodes(row._id)})));total=count;}
  else {const rows=await rewardModel.listAllRewards();total=rows.length;items=await Promise.all(rows.slice((page-1)*limit,page*limit).map(async row=>({...row,availableVoucherCount:await rewardModel.countAvailableVoucherCodes(row.id)})));}
  successResponse(res,200,'Admin rewards',{items,total,page,limit,totalPages:Math.ceil(total/limit)});
}catch(error){next(error);}});
function rewardPayload(body, partial=false){
  const payload={};
  for(const field of ['title','description','provider','partnerId','terms','status']) if(body?.[field]!==undefined)payload[field]=body[field];
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
async function attachPartner(payload){if(!payload.partnerId)return payload;const partner=await partnerModel.find(payload.partnerId);if(!partner||partner.status!=='ACTIVE')throw new AppError('Select an approved active partner',400);payload.provider=partner.name;return payload;}
router.post('/rewards',adminWriteLimiter,async(req,res,next)=>{try{const reward=await rewardModel.createReward(await attachPartner(rewardPayload(req.body)));await audit.createAuditLog({userId:req.user.id,action:'ADMIN_REWARD_CREATED',metadata:{rewardId:reward.id,title:reward.title},requestId:req.requestId});successResponse(res,201,'Reward created',{reward});}catch(error){next(error);}});
router.patch('/rewards/:id',adminWriteLimiter,async(req,res,next)=>{try{const reward=await rewardModel.updateReward(req.params.id,await attachPartner(rewardPayload(req.body,true)));if(!reward)throw new AppError('Reward not found',404);await audit.createAuditLog({userId:req.user.id,action:'ADMIN_REWARD_UPDATED',metadata:{rewardId:reward.id,changes:Object.keys(req.body||{})},requestId:req.requestId});successResponse(res,200,'Reward updated',{reward});}catch(error){next(error);}});
router.post('/rewards/:id/vouchers',adminWriteLimiter,async(req,res,next)=>{try{
  const reward=await rewardModel.findRewardById(req.params.id);if(!reward)throw new AppError('Reward not found',404);
  const input=req.body?.codes;
  if(!Array.isArray(input)||input.length<1||input.length>500)throw new AppError('Provide 1 to 500 voucher codes',400);
  let expiresAt=null;if(req.body?.expiresAt){expiresAt=new Date(req.body.expiresAt);if(!Number.isFinite(+expiresAt)||expiresAt<=new Date())throw new AppError('Voucher expiry must be a future date',400);}
  const codeService=require('../services/voucher-code.service');
  const seen=new Set();const rows=[];
  for(const raw of input){if(typeof raw!=='string')throw new AppError('Voucher codes must be text',400);const code=raw.trim();if(!code||code.length>160)throw new AppError('Each voucher code must be 1 to 160 characters',400);const codeHash=codeService.hash(code);if(seen.has(codeHash))continue;seen.add(codeHash);rows.push({codeHash,encryptedCode:codeService.encrypt(code),expiresAt});}
  if(!rows.length)throw new AppError('No unique voucher codes to import',400);
  let imported;
  if(env.useMongoDB){const mongoose=require('mongoose');imported=await mongoose.connection.transaction(async session=>rewardModel.importVoucherCodes(req.params.id,rows,session));}
  else imported=await rewardModel.importVoucherCodes(req.params.id,rows);
  await audit.createAuditLog({userId:req.user.id,action:'ADMIN_VOUCHERS_IMPORTED',metadata:{rewardId:req.params.id,count:imported},requestId:req.requestId});
  successResponse(res,201,'Voucher codes imported',{imported,availableVoucherCount:await rewardModel.countAvailableVoucherCodes(req.params.id)});
}catch(error){if(error.code===11000)error=new AppError('One or more voucher codes already exist in inventory',409);next(error);}});
router.get('/rewards/:id/vouchers',async(req,res,next)=>{try{const reward=await rewardModel.findRewardById(req.params.id);if(!reward)throw new AppError('Reward not found',404);const page=Number(req.query.page||1),limit=Number(req.query.limit||50);if(!Number.isInteger(page)||page<1||!Number.isInteger(limit)||limit<1||limit>100)throw new AppError('Invalid voucher pagination parameters',400);const inventory=await rewardModel.listVoucherCodes(req.params.id,{page,limit});successResponse(res,200,'Voucher inventory',{...inventory,page,limit,totalPages:Math.ceil(inventory.total/limit)});}catch(error){next(error);}});
router.get('/redemptions',async(req,res,next)=>{try{
  const page=Number(req.query.page||1),limit=Number(req.query.limit||20);
  if(!Number.isInteger(page)||page<1||!Number.isInteger(limit)||limit<1||limit>100)throw new AppError('Invalid pagination parameters',400);
  let rows,total;
  if(env.useMongoDB){[rows,total]=await Promise.all([rewardModel.Redemption.find().sort({createdAt:-1,_id:-1}).skip((page-1)*limit).limit(limit).populate('rewardId','title').populate('redeemedByPartnerId','name').lean(),rewardModel.Redemption.countDocuments()]);
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
    successResponse(res,200,'User details',{user,wallet:points,recordCount:records.total,deviceCount:devices.total,canChangeStatus:req.adminRole==='ADMIN'&&user.id!==req.user.id&&!env.adminEmails.includes(user.email.toLowerCase())});
  }catch(error){next(error);}
});
router.get('/users/:id/record-chart',async(req,res,next)=>{try{const user=await findUser(req.params.id);successResponse(res,200,'All-date activity chart',await require('../services/record-chart.service').chart(user.id,req.query));}catch(error){next(error);}});
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
  successResponse(res,200,'User points ledger',{items,total,page,limit,totalPages:Math.ceil(total/limit)});
 }catch(error){next(error);}
});
router.get('/users/:id/daily',async(req,res,next)=>{try{const user=await findUser(req.params.id);successResponse(res,200,'Daily points',await require('../services/daily-settlement.service').progress(user.id,req.query.day));}catch(error){next(error);}});
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
  successResponse(res,result.duplicate?200:201,'Activity recorded; points follow daily settlement',result);
 }catch(error){next(error);}
});
router.get('/settlements/status',async(req,res,next)=>{
  try { const {DailyActivity,memoryDays}=require('../models/daily-activity.model');
    const counts=env.useMongoDB?await DailyActivity.aggregate([{$group:{_id:'$state',count:{$sum:1}}}]):Object.entries([...memoryDays.values()].reduce((out,row)=>{out[row.state]=(out[row.state]||0)+1;return out;},{})).map(([state,count])=>({_id:state,count}));
    successResponse(res,200,'Settlement worker status',{enabled:env.settlementEnabled&&env.useMongoDB,timezone:'Asia/Kolkata',batchSize:20,concurrency:2,counts});
  }catch(error){next(error);}
});
router.get('/settlements/queue',fullAdminOnly,async(req,res,next)=>{
  try { const {page,limit}=query.buildQuery('users',req.query);const state=req.query.state;if(state&&!['PENDING','RETRY','PROCESSING'].includes(state))throw new AppError('state must be PENDING, RETRY, or PROCESSING',400);successResponse(res,200,'Settlement queue fetched',await require('../services/daily-settlement.service').adminQueue({page,limit,state})); }
  catch(error){next(error);}
});
router.post('/settlements/:id/retry',fullAdminOnly,adminWriteLimiter,async(req,res,next)=>{
  try { const row=await require('../services/daily-settlement.service').retryAdmin(req.params.id);if(!row)throw new AppError('Retryable settlement not found',404);await audit.createAuditLog({userId:req.user.id,action:'ADMIN_SETTLEMENT_RETRY_QUEUED',metadata:{settlementId:req.params.id,day:row.day},requestId:req.requestId});successResponse(res,200,'Settlement retry queued',{settlement:row}); }
  catch(error){next(error);}
});
router.post('/settlements/run',adminWriteLimiter,async(req,res,next)=>{
  try {
    const settlement=require('../services/daily-settlement.service');
    const totals={claimed:0,settled:0,failed:0,coinsCredited:0,batches:0};
    // Bound each admin request to 100 user-day rows; cron/worker safely continues the queue.
    for(let batch=0;batch<5;batch++){
      const result=await settlement.processBatch({batchSize:20,concurrency:2});
      totals.batches++;
      for(const field of ['claimed','settled','failed','coinsCredited'])totals[field]+=result[field]||0;
      if(result.claimed<20)break;
    }
    totals.hasMore=totals.claimed===100;
    await audit.createAuditLog({userId:req.user.id,action:'ADMIN_DAILY_SETTLEMENT_RUN',metadata:totals,requestId:req.requestId});
    successResponse(res,200,totals.claimed?'Pending point settlements processed':'No matured point settlements are waiting',totals);
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
router.post('/users/bulk-status',fullAdminOnly,adminWriteLimiter,async(req,res,next)=>{
 try {
  const {ids,status}=req.body||{};if(!Array.isArray(ids)||ids.length<1||ids.length>100||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)throw new AppError('ids must contain 1 to 100 unique user IDs',400);
  if(!['ACTIVE','SUSPENDED'].includes(status))throw new AppError('status must be ACTIVE or SUSPENDED',400);
  const results=[];
  for(const id of ids){const user=await users.findUserById(id);if(!user){results.push({id,success:false,error:'NOT_FOUND'});continue;}if(user.id===req.user.id||env.adminEmails.includes(user.email.toLowerCase())||['ADMIN','SUB_ADMIN'].includes(user.role)){results.push({id,success:false,error:'ADMIN_ACCOUNT'});continue;}const updated=await users.updateStatus(user.id,status);results.push({id:user.id,success:true,status:updated.status});}
  await audit.createAuditLog({userId:req.user.id,action:'ADMIN_USERS_BULK_STATUS_CHANGED',metadata:{requested:ids.length,status,succeeded:results.filter(row=>row.success).length,failed:results.filter(row=>!row.success).length},requestId:req.requestId});
  successResponse(res,200,'Bulk user status update completed',{status,results,succeeded:results.filter(row=>row.success).length,failed:results.filter(row=>!row.success).length});
 }catch(error){next(error);}
});
router.patch('/devices/:id/status',fullAdminOnly,adminWriteLimiter,async(req,res,next)=>{
 try {const status=req.body?.status;if(!['ACTIVE','REMOVED'].includes(status))throw new AppError('status must be ACTIVE or REMOVED',400);const device=await require('../models/device.model').setAdminDeviceStatus(req.params.id,status);if(!device)throw new AppError('Device not found',404);await audit.createAuditLog({userId:req.user.id,action:'ADMIN_DEVICE_STATUS_CHANGED',metadata:{deviceId:device.id,userId:device.userId,status},requestId:req.requestId});successResponse(res,200,'Device status updated',{device});}
 catch(error){next(error);}
});
module.exports=router;
