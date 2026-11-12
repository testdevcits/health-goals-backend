const mongoose = require('mongoose');
const env = require('../config/env');
const model = require('../models/challenge.model');
const notifications = require('../models/notification.model');
const users = require('../models/user.model');
const { AppError } = require('../middleware/error.middleware');
const metricLabels={STEPS:'steps',WORKOUT_MINUTES:'workout minutes',ACTIVE_MINUTES:'active minutes'};
function validate(input, partial=false){
 const body=input||{},allowed=['title','description','metric','targetValue','month','winnerMode','winnersCount','rewardDescription','rewardPoints'];
 if(Object.keys(body).some(key=>!allowed.includes(key)))throw new AppError('Unsupported challenge field',400);
 const out={};for(const key of allowed)if(body[key]!==undefined)out[key]=body[key];
 if(!partial||out.title!==undefined){if(typeof out.title!=='string'||out.title.trim().length<3||out.title.trim().length>100)throw new AppError('Challenge title must be 3 to 100 characters',400);out.title=out.title.trim();}
 if(!partial||out.description!==undefined){out.description=String(out.description||'').trim();if(out.description.length>1000)throw new AppError('Description must be 1000 characters or fewer',400);}
 if(!partial||out.metric!==undefined){if(!['STEPS','WORKOUT_MINUTES','ACTIVE_MINUTES'].includes(out.metric))throw new AppError('Choose steps, workout minutes, or active minutes',400);}
 if(!partial||out.targetValue!==undefined){out.targetValue=Number(out.targetValue);if(!Number.isSafeInteger(out.targetValue)||out.targetValue<1||out.targetValue>100000000)throw new AppError('Target must be a positive whole number',400);}
 if(!partial||out.month!==undefined){if(typeof out.month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(out.month))throw new AppError('Choose a valid month in YYYY-MM format',400);}
 if(out.month){const start=new Date(`${out.month}-01T00:00:00+05:30`);const [year,month]=out.month.split('-').map(Number);const end=new Date(Date.UTC(year,month-1+1,1)-330*60000);if(!Number.isFinite(+start)||!Number.isFinite(+end)||end<=start)throw new AppError('Invalid challenge month',400);out.startsAt=start;out.endsAt=end;}
 if(!partial||out.winnerMode!==undefined){if(!['TOP_N','ALL_TARGET_MET'].includes(out.winnerMode))throw new AppError('Choose top winners or everyone who reaches the target',400);}
 if(!partial||out.winnersCount!==undefined){out.winnersCount=Number(out.winnersCount??3);if(!Number.isSafeInteger(out.winnersCount)||out.winnersCount<1||out.winnersCount>10000)throw new AppError('Winner count must be 1 to 10000',400);}
 if(!partial||out.rewardDescription!==undefined){out.rewardDescription=String(out.rewardDescription||'').trim();if(out.rewardDescription.length>300)throw new AppError('Reward description must be 300 characters or fewer',400);}
 if(!partial||out.rewardPoints!==undefined){out.rewardPoints=Number(out.rewardPoints??0);if(!Number.isSafeInteger(out.rewardPoints)||out.rewardPoints<0||out.rewardPoints>100000)throw new AppError('Reward points must be between 0 and 100000',400);}
 return out;
}
async function create(input,adminId){const data=validate(input);return model.create(data,adminId);}
async function update(id,input,adminId){if(env.useMongoDB&&!mongoose.isValidObjectId(id))return null;const current=await model.find(id);if(!current)return null;if(current.status!=='DRAFT'&&current.status!=='PAUSED')throw new AppError('Published or completed challenges cannot be edited',409);return model.update(id,validate(input,true),adminId);}
async function remove(id){if(env.useMongoDB&&!mongoose.isValidObjectId(id))return null;const current=await model.find(id);if(!current)return null;if(current.finalizedAt||current.status==='ENDED')throw new AppError('Finalized challenges cannot be deleted',409);const deleted=await model.remove(id);if(!deleted)throw new AppError('Challenge changed or was finalized while deleting; refresh and try again',409);await notifications.removeChallengeNotifications(id);return deleted;}
async function publish(id,adminId){if(env.useMongoDB&&!mongoose.isValidObjectId(id))return null;const current=await model.find(id);if(!current)return null;if(!['DRAFT','PAUSED'].includes(current.status))throw new AppError('Only a draft or paused challenge can be published',409);if(current.finalizedAt||new Date(current.endsAt)<=new Date())throw new AppError('This challenge month has already ended',409);const row=await model.publish(id,adminId);if(row){
 const targets=env.useMongoDB?await users.User.find({status:'ACTIVE',role:'USER'}).select('_id').lean().then(items=>items.map(item=>String(item._id))):(await users.listUsers()).filter(item=>item.status==='ACTIVE'&&item.role==='USER').map(item=>String(item.id));
 for(const userId of targets)await notifications.createForUser(userId,{type:'CHALLENGE_PUBLISHED',title:`New challenge: ${row.title}`,body:`Join the ${row.month} challenge and reach ${row.targetValue.toLocaleString()} ${metricLabels[row.metric]}.`,data:{challengeId:row.id},key:`challenge:${row.id}:published:${userId}`});
 }
 return row;}
async function evaluate(now=new Date()){return model.finalizeDue(now,notifyResult);}
async function setStatus(id,status,adminId){if(env.useMongoDB&&!mongoose.isValidObjectId(id))return null;if(!['PAUSED','PUBLISHED'].includes(status))throw new AppError('Status must be PAUSED or PUBLISHED',400);return model.setStatus(id,status,adminId);}
async function join(id,userId){if(env.useMongoDB&&!mongoose.isValidObjectId(id))throw new AppError('Challenge not found',404);const existing=await model.find(id);if(!existing)throw new AppError('Challenge not found',404);const alreadyJoined=(existing.participants||[]).some(item=>String(item.userId?._id||item.userId)===String(userId));const result=await model.join(id,env.useMongoDB?new mongoose.Types.ObjectId(userId):userId);if(!result)throw new AppError('Challenge not found',404);if(result.error)throw new AppError(result.error,409);const user=await users.findUserById(userId);const row=await model.find(id);if(!alreadyJoined)await notifications.createForUser(row.createdBy,{type:'CHALLENGE_JOINED',title:`${user?.name||'A member'} joined ${row.title}`,body:`${(row.participants||[]).length} members have joined this challenge.`,data:{challengeId:id},key:`challenge:${id}:joined:${userId}`});return result;}
async function notifyResult(userId,input){return notifications.createForUser(userId,input);}
module.exports={validate,create,update,remove,publish,setStatus,join,notifyResult,evaluate};
