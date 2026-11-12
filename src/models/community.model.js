const mongoose = require('mongoose');
const env = require('../config/env');
const crypto = require('crypto');
const { AppError } = require('../middleware/error.middleware');

const memberSchema = new mongoose.Schema({ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, joinedAt: { type: Date, default: null } }, { _id: false });
const GROUP_MEMBER_LIMIT = 10;
const groupSchema = new mongoose.Schema({ name: { type: String, required: true, trim: true, maxlength: 50 }, description: { type: String, default: '', maxlength: 300 }, emoji: { type: String, default: '🏃' }, imageUrl: { type: String, default: null, maxlength: 2048 }, isPrivate: { type: Boolean, default: false }, maxMembers: { type: Number, default: GROUP_MEMBER_LIMIT, min: GROUP_MEMBER_LIMIT, max: GROUP_MEMBER_LIMIT }, createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, members: { type: [memberSchema], default: [] }, deletedAt: { type: Date, default: null, index: true }, deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null } }, { timestamps: true });
groupSchema.index({ 'members.userId': 1, updatedAt: -1 });
const messageSchema = new mongoose.Schema({ groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunityGroup', required: true, index: true }, userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, message: { type: String, required: true, maxlength: 1000 } }, { timestamps: true });
const challengeSchema = new mongoose.Schema({ title: { type: String, required: true, maxlength: 100 }, description: { type: String, default: '', maxlength: 500 }, metricType: { type: String, enum: ['steps', 'workout', 'active_minutes'], default: 'steps' }, targetValue: { type: Number, required: true }, startsAt: { type: Date, required: true }, endsAt: { type: Date, required: true }, groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunityGroup', default: null, index: true }, createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, rewardPoints: { type: Number, default: 0 }, status: { type: String, enum: ['ACTIVE', 'ENDED'], default: 'ACTIVE' }, participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }] }, { timestamps: true });
const Group = mongoose.model('CommunityGroup', groupSchema);
const Message = mongoose.model('GroupMessage', messageSchema);
const Challenge = mongoose.model('CommunityChallenge', challengeSchema);
const memoryGroups = [], memoryMessages = [], memoryChallenges = [];
const memoryGroupMemberships = new Map();
const idOf = x => String(x?._id || x?.id || x);
const memberJoinedAt = (group,userId) => {
 const member=(group.members||[]).find(row=>idOf(row.userId||row)===String(userId));
 return new Date(member?.joinedAt||group.createdAt||group.created_at||0);
};
const activityStartAt = record => new Date(record.startTime || (record.activityDate ? `${record.activityDate}T00:00:00+05:30` : record.recordedAt));
async function assertSingleGroupMembership(userId,exceptGroupId=null){
 const other=env.useMongoDB
  ?await Group.findOne({'members.userId':userId,deletedAt:null,...(exceptGroupId?{_id:{$ne:exceptGroupId}}:{})}).select('name').lean()
  :memoryGroups.find(group=>!group.deletedAt&&String(group.id)!==String(exceptGroupId||'')&&(group.members||[]).some(member=>String(member.userId)===String(userId)));
 if(other)throw new AppError(`Leave ${other.name||'your current group'} before joining another group`,409);
}
async function claimGroupMembership(userId,groupId){
 if(env.useMongoDB){
  const {User}=require('./user.model');
  const result=await User.updateOne({_id:userId,$or:[{activeGroupId:null},{activeGroupId:groupId}]},{$set:{activeGroupId:groupId}});
  if(!result.matchedCount)throw new AppError('You can belong to only one group at a time. Leave your current group first.',409);
  return;
 }
 const existing=memoryGroupMemberships.get(String(userId));
 if(existing&&String(existing)!==String(groupId))throw new AppError('Leave your current group before joining another group',409);
 memoryGroupMemberships.set(String(userId),String(groupId));
}
async function releaseGroupMembership(userId,groupId){
 if(env.useMongoDB){const {User}=require('./user.model');await User.updateOne({_id:userId,activeGroupId:groupId},{$set:{activeGroupId:null}});return;}
 if(String(memoryGroupMemberships.get(String(userId)))===String(groupId))memoryGroupMemberships.delete(String(userId));
}
const groupDto = (x, userId) => ({ id: idOf(x), name: x.name, description: x.description || '', emoji: x.emoji || '🏃', imageUrl: x.imageUrl || null, private: Boolean(x.isPrivate ?? x.private), members: (x.members || []).length, maxMembers: GROUP_MEMBER_LIMIT, leaderId: idOf(x.createdBy), leaderName:x.createdBy?.name||x.leaderName||null, leaderPublicId:x.createdBy?.publicId||null, isLeader: idOf(x.createdBy) === String(userId), avatars: (x.members || []).slice(0,4).map(m=>({initial:(m.name||m.userId?.name||'M')[0]})), joined: (x.members || []).some(m => idOf(m.userId || m) === String(userId)), createdAt: x.createdAt || x.created_at });
const messageDto = (x, user) => ({ id: idOf(x), senderId: idOf(x.userId), name: user?.name || x.name || 'Member', initials: (user?.name || x.name || 'M').split(/\s+/).map(x => x[0]).slice(0,2).join('').toUpperCase(), message: x.message, time: new Date(x.createdAt || x.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), createdAt: x.createdAt || x.created_at, mine: String(user?.id || '') === idOf(x.userId) });
const challengeCategory = metricType => metricType === 'steps' ? 'steps' : metricType === 'workout' ? 'strength' : metricType === 'active_minutes' ? 'other' : 'other';
const challengeDto = x => ({ id: idOf(x), title: x.title, description: x.description || '', metricType: x.metricType, category: x.category || challengeCategory(x.metricType), targetValue: x.targetValue, startsAt: x.startsAt, endsAt: x.endsAt, groupId: x.groupId ? idOf(x.groupId) : null, rewardPoints: x.rewardPoints || 0, status: x.status, participants: Number(x.participantCount ?? x.participants?.length ?? 0), joined: Boolean(x.joined), joinable: Boolean(x.joinable), progress: x.progress || 0, currentValue: x.currentValue || 0 });
async function createGroup(userId, input) {
 await assertSingleGroupMembership(userId);
 const groupId=env.useMongoDB?new mongoose.Types.ObjectId():crypto.randomUUID();
 await claimGroupMembership(userId,groupId);
 const joinedAt=new Date();
 const row = { ...(env.useMongoDB?{_id:groupId}:{}),name: input.name.trim(), description: String(input.description || '').trim(), emoji: input.emoji || '🏃', isPrivate: Boolean(input.private), maxMembers: GROUP_MEMBER_LIMIT, createdBy: userId, members: [{ userId, joinedAt }] };
 try {
  if (env.useMongoDB) {const created=await Group.create(row);await created.populate('createdBy','name publicId');return groupDto(created,userId);}
  const item = { ...row, id: groupId, members: [{ userId, joinedAt }], created_at: new Date().toISOString() };memoryGroupMemberships.set(String(userId),item.id);memoryGroups.unshift(item);const user=await require('./user.model').findUserById(userId);return groupDto({...item,createdBy:{id:userId,name:user?.name,publicId:user?.publicId}},userId);
 } catch(error) { await releaseGroupMembership(userId,groupId);throw error; }
}
async function listGroups(userId, discover = false) {
 if (env.useMongoDB) { const query = discover ? { isPrivate: false, deletedAt: null } : { 'members.userId': userId, deletedAt: null }; return (await Group.find(query).populate('createdBy','name publicId').populate('members.userId','name').sort({ updatedAt: -1 }).lean()).map(row => groupDto(row, userId)); }
 const users=await require('./user.model').listUsers(),byId=new Map(users.map(user=>[String(user.id),user]));return memoryGroups.filter(row => !row.deletedAt&&(discover ? !row.isPrivate : row.members.some(m => String(m.userId) === String(userId)))).map(row => groupDto({...row,createdBy:{id:row.createdBy,name:byId.get(String(row.createdBy))?.name,publicId:byId.get(String(row.createdBy))?.publicId},members:row.members.map(member=>({...member,name:byId.get(String(member.userId))?.name}))},userId));
}
async function findGroup(id) {
 if (env.useMongoDB) { if (!mongoose.isValidObjectId(id)) return null; return Group.findOne({ _id: id, deletedAt: null }); }
 return memoryGroups.find(x => String(x.id) === String(id) && !x.deletedAt) || null;
}
async function findChallenge(id) {
 if(env.useMongoDB){if(!mongoose.isValidObjectId(id))return null;return Challenge.findById(id);}
 return memoryChallenges.find(item=>String(item.id)===String(id))||null;
}
async function updateGroup(id,leaderId,changes){
 const row=await findGroup(id);if(!row)throw new AppError('Group not found',404);if(idOf(row.createdBy)!==String(leaderId))throw new AppError('Only the group leader can edit group details',403);
 if(env.useMongoDB){const updated=await Group.findOneAndUpdate({_id:id,createdBy:leaderId,deletedAt:null},{$set:changes},{new:true,runValidators:true}).populate('createdBy','name publicId').lean();if(!updated)throw new AppError('Only the group leader can edit group details',403);return groupDto(updated,leaderId);}
 Object.assign(row,changes);const user=await require('./user.model').findUserById(leaderId);return groupDto({...row,createdBy:{id:leaderId,name:user?.name,publicId:user?.publicId}},leaderId);
}
async function joinGroup(id,userId) {
 const row=await findGroup(id); if(!row)throw new AppError('Group not found',404);
 if(Boolean(row.isPrivate??row.private)&&!(row.members||[]).some(m=>idOf(m.userId||m)===String(userId)))throw new AppError('Private groups require an invitation from the group leader',403);
 const existing=(row.members||[]).some(m=>idOf(m.userId||m)===String(userId));
 await assertSingleGroupMembership(userId,id);
 await claimGroupMembership(userId,id);
 try {
  if(env.useMongoDB){if(!existing){const joinedAt=new Date();const result=await Group.updateOne({_id:id,deletedAt:null,'members.userId':{$ne:userId},$expr:{$lt:[{$size:{$ifNull:['$members',[]]}},GROUP_MEMBER_LIMIT]}},{$push:{members:{userId,joinedAt}}});if(!result.modifiedCount){const latest=await Group.findById(id).lean();if(!(latest?.members||[]).some(member=>idOf(member.userId||member)===String(userId)))throw new AppError('This group has reached its 10-member limit or is archived',409);return groupDto(latest,userId);}}return groupDto(await Group.findById(id).lean(),userId);}
  if(!existing){if((row.members||[]).length>=GROUP_MEMBER_LIMIT)throw new AppError('This group has reached its 10-member limit',409);row.members.push({userId,joinedAt:new Date()});}return groupDto(row,userId);
 } catch(error) {if(!existing)await releaseGroupMembership(userId,id);throw error;}
}
async function addGroupMember(id,leaderId,memberId){
 const row=await findGroup(id);if(!row)throw new AppError('Group not found',404);if(idOf(row.createdBy)!==String(leaderId))throw new AppError('Only the group leader can add members',403);
 const member=await require('./user.model').findUserById(memberId);if(!member||member.status!=='ACTIVE')throw new AppError('Active user not found',404);
 const existing=(row.members||[]).some(m=>idOf(m.userId||m)===String(memberId));
 if(!existing&&row.members.length>=GROUP_MEMBER_LIMIT)throw new AppError('Group is full; maximum is 10',409);
 await assertSingleGroupMembership(memberId,id);
 await claimGroupMembership(memberId,id);
 try {
  if(env.useMongoDB){if(!existing){const result=await Group.updateOne({_id:id,createdBy:leaderId,deletedAt:null,'members.userId':{$ne:memberId},$expr:{$lt:[{$size:{$ifNull:['$members',[]]}},GROUP_MEMBER_LIMIT]}},{$push:{members:{userId:memberId,joinedAt:new Date()}}});if(!result.modifiedCount){const latest=await Group.findById(id).lean();if(!(latest?.members||[]).some(entry=>idOf(entry.userId||entry)===String(memberId)))throw new AppError('Group is full, archived, or membership changed; maximum is 10',409);return groupDto(latest,leaderId);}}return groupDto(await Group.findById(id).lean(),leaderId);}
  if(!existing)row.members.push({userId:memberId,joinedAt:new Date()});return groupDto(row,leaderId);
 } catch(error) {if(!existing)await releaseGroupMembership(memberId,id);throw error;}
}
async function leaveGroup(id,userId){
 const row=await findGroup(id);if(!row)throw new AppError('Group not found',404);if(!(row.members||[]).some(m=>idOf(m.userId||m)===String(userId)))throw new AppError('You are not a member of this group',409);
 if(env.useMongoDB){
  if(idOf(row.createdBy)===String(userId)){const next=(row.members||[]).filter(m=>idOf(m.userId)!==String(userId)).sort((a,b)=>new Date(a.joinedAt||0)-new Date(b.joinedAt||0))[0];if(!next){const deletedAt=new Date();await Group.updateOne({_id:id,createdBy:userId,deletedAt:null},{$set:{deletedAt,deletedBy:userId}});await releaseGroupMembership(userId,id);return {id,deleted:true,softDeleted:true,deletedAt};}await Group.updateOne({_id:id,createdBy:userId,'members.userId':userId,deletedAt:null},{$pull:{members:{userId}},$set:{createdBy:next.userId}});await require('./user.model').User.updateOne({_id:next.userId},{$set:{activeGroupId:id}});}
  else await Group.updateOne({_id:id,'members.userId':userId},{$pull:{members:{userId}}});
  await releaseGroupMembership(userId,id);
  return {group:groupDto(await Group.findById(id).lean(),userId),deleted:false};
 }
 if(idOf(row.createdBy)===String(userId)){const remaining=row.members.filter(m=>String(m.userId)!==String(userId)).sort((a,b)=>new Date(a.joinedAt||0)-new Date(b.joinedAt||0));if(!remaining.length){row.deletedAt=new Date();row.deletedBy=userId;await releaseGroupMembership(userId,id);return {id,deleted:true,softDeleted:true,deletedAt:row.deletedAt};}row.members=remaining;row.createdBy=remaining[0].userId;memoryGroupMemberships.set(String(remaining[0].userId),String(id));}
 else row.members=row.members.filter(m=>String(m.userId)!==String(userId));
 await releaseGroupMembership(userId,id);return {group:groupDto(row,userId),deleted:false};
}
async function deleteGroup(id,leaderId){
 const row=await findGroup(id);if(!row)throw new AppError('Group not found',404);if(idOf(row.createdBy)!==String(leaderId))throw new AppError('Only the group leader can delete this group',403);
 const deletedAt=new Date();
 if(env.useMongoDB){const result=await Group.updateOne({_id:id,createdBy:leaderId,deletedAt:null},{$set:{deletedAt,deletedBy:leaderId}});if(!result.modifiedCount)throw new AppError('Group not found or already deleted',404);await require('./user.model').User.updateMany({activeGroupId:id},{$set:{activeGroupId:null}});}
 else {row.deletedAt=deletedAt;row.deletedBy=leaderId;for(const member of row.members||[])await releaseGroupMembership(idOf(member.userId||member),id);}
 return {id,deleted:true,softDeleted:true,deletedAt};
}
async function getGroup(id,userId){let row=await findGroup(id);if(!row)throw new AppError('Group not found',404);if(env.useMongoDB)await row.populate([{path:'createdBy',select:'name publicId'},{path:'members.userId',select:'name'}]);const members=row.members||[];if(row.isPrivate&&!members.some(m=>idOf(m.userId||m)===String(userId)))throw new AppError('Join this private group to view it',403);return groupDto(row,userId);}
async function postMessage(id,userId,message){const group=await findGroup(id);if(!group)throw new AppError('Group not found',404);if(!(group.members||[]).some(m=>idOf(m.userId||m)===String(userId)))throw new AppError('Join the group before posting',403);const author=await require('./user.model').findUserById(userId);if(env.useMongoDB)return messageDto(await Message.create({groupId:id,userId,message}),{id:userId,name:author?.name});const row={id:crypto.randomUUID(),groupId:id,userId,message,created_at:new Date().toISOString()};memoryMessages.push(row);return messageDto(row,{id:userId,name:author?.name});}
async function listMessages(id,userId){const group=await findGroup(id);if(!group)throw new AppError('Group not found',404);if(!(group.members||[]).some(m=>idOf(m.userId||m)===String(userId)))throw new AppError('Join the group before viewing its chat',403);let rows=env.useMongoDB?await Message.find({groupId:id}).sort({createdAt:1}).limit(100).populate('userId','name').lean():memoryMessages.filter(m=>String(m.groupId)===String(id)).slice(-100);return rows.map(r=>messageDto(r,{id:idOf(r.userId),name:r.userId?.name||r.name}));}
async function listFeed(userId){
 const groups=await listGroups(userId);const ids=groups.map(g=>g.id);let rows=[];
 if(env.useMongoDB){rows=await Message.find({groupId:{$in:ids}}).sort({createdAt:-1}).limit(50).populate('userId','name').populate('groupId','name emoji').lean();}
 else rows=memoryMessages.filter(m=>ids.includes(String(m.groupId))).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,50).map(m=>({...m,groupId:memoryGroups.find(g=>String(g.id)===String(m.groupId))}));
 return rows.map(row=>({id:idOf(row),name:row.userId?.name||row.name||'Member',initials:(row.userId?.name||row.name||'M').split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase(),group:row.groupId?.name||'Group',time:row.createdAt||row.created_at,message:row.message,emoji:row.groupId?.emoji||'💬',color:'#00C6A2',kudos:0,comments:0}));
}
async function createChallenge(userId,input){const row={...input,createdBy:userId,participants:[userId],status:new Date(input.endsAt)>new Date()?'ACTIVE':'ENDED'};return env.useMongoDB?challengeDto(await Challenge.create(row)):(()=>{const item={...row,id:crypto.randomUUID(),createdAt:new Date().toISOString()};memoryChallenges.unshift(item);return challengeDto(item);})();}
async function listChallenges(userId,groupId=null,now=new Date()) {
 let membershipStart=null;
 if(groupId){const group=await findGroup(groupId);if(!group)throw new AppError('Group not found',404);if(!(group.members||[]).some(member=>idOf(member.userId||member)===String(userId)))throw new AppError('Join the group to view its challenges',403);membershipStart=memberJoinedAt(group,userId);}
 const query=groupId?{groupId}:{status:'ACTIVE',groupId:null,endsAt:{$gt:now}};
 const rows=env.useMongoDB?await Challenge.aggregate([
  {$match:query},
  {$addFields:{participantCount:{$size:{$ifNull:['$participants',[]]}},joined:{$in:[new mongoose.Types.ObjectId(userId),{$ifNull:['$participants',[]]}]}}},
  {$project:{title:1,description:1,metricType:1,targetValue:1,startsAt:1,endsAt:1,groupId:1,rewardPoints:1,status:1,participantCount:1,joined:1}},
  {$sort:{startsAt:1}},
 ]):memoryChallenges.filter(x=>groupId?String(x.groupId)===String(groupId):x.status==='ACTIVE'&&!x.groupId&&new Date(x.endsAt)>now);
 const health=require('./health.model'),joinedRows=rows.filter(row=>row.joined??(row.participants||[]).some(person=>idOf(person)===String(userId)));
 const challengeStart=joinedRows.length?Math.min(...joinedRows.map(row=>+new Date(row.startsAt))):+now;
 const start=joinedRows.length?new Date(Math.max(challengeStart,membershipStart?+membershipStart:-Infinity)):now;
 const end=joinedRows.length?new Date(Math.min(+now,Math.max(...joinedRows.map(row=>+new Date(row.endsAt))))):now;
 let records=[];
 if(joinedRows.length){
  records=env.useMongoDB
   ?await health.HealthRecord.find({userId:new mongoose.Types.ObjectId(userId),metricType:{$in:[...new Set(joinedRows.map(row=>row.metricType))]},recordedAt:{$gte:start,$lt:end},deleted:{$ne:true}}).select('userId metricType value recordedAt source activityDate startTime endTime metadata deleted').lean().then(items=>items.map(health.toHealthRecord))
   :health.healthRecords.filter(record=>String(record.user_id)===String(userId)&&!record.deleted&&new Date(record.recorded_at)>=start&&new Date(record.recorded_at)<end).map(health.toHealthRecord);
 }
 return rows.map(row=>{
  const joined=row.joined??(row.participants||[]).some(person=>idOf(person)===String(userId));
  const validStart=Math.max(+new Date(row.startsAt),membershipStart?+membershipStart:-Infinity);
  const matchingRecords=joined?records.filter(record=>record.metricType===row.metricType&&!record.deleted&&activityStartAt(record)>=validStart&&activityStartAt(record)<=new Date(row.endsAt)):[];
  const currentValue=matchingRecords.reduce((total,record)=>{
   if(row.metricType==='steps'){
    const isDailyHealthConnectTotal=record.source==='health_connect'&&(record.metadata?.aggregation==='daily_total'||record.metadata?.aggregationScope==='health_connect');
    return total+(isDailyHealthConnectTotal?Number(record.value||0):0);
   }
   if(row.metricType==='workout'&&record.startTime&&record.endTime)return total+Math.max(0,(+new Date(record.endTime)-+new Date(record.startTime))/60000);
   if(row.metricType==='active_minutes')return total+Number(record.value||0);
   return total;
  },0);
  return challengeDto({...row,joined,joinable:!joined&&row.status==='ACTIVE'&&new Date(row.startsAt)<=now&&new Date(row.endsAt)>now,currentValue,progress:row.targetValue?Math.min(100,Math.round(currentValue/row.targetValue*100)):0});
 });
}
async function joinChallenge(id,userId){const row=await findChallenge(id);if(!row)throw new AppError('Challenge not found',404);const now=new Date();if(row.status!=='ACTIVE'||now<new Date(row.startsAt)||now>=new Date(row.endsAt))throw new AppError('This challenge is not currently open for joining',409);if(row.groupId){const group=await getGroup(String(row.groupId),userId);if(!group.joined)throw new AppError('Join the group before joining its challenge',403);}if(env.useMongoDB){await Challenge.updateOne({_id:id,status:'ACTIVE',startsAt:{$lte:now},endsAt:{$gt:now},participants:{$ne:userId}},{$addToSet:{participants:userId}});const updated=await Challenge.findById(id).lean();return challengeDto({...updated,joined:true});}if(!(row.participants||[]).some(person=>String(person)===String(userId)))row.participants.push(userId);return challengeDto({...row,joined:true});}
async function groupLeaderboard(id,userId){
 const group=await findGroup(id);if(!group)throw new AppError('Group not found',404);
 const members=group.members||[];
 if(!members.some(member=>idOf(member.userId||member)===String(userId)))throw new AppError('Join the group to view its leaderboard',403);
 const ids=members.map(member=>idOf(member.userId||member)),weekStart=new Date(Date.now()-7*86400000),totals=new Map();
 if(env.useMongoDB){
  const branches=members.map(member=>({case:{$eq:['$userId',member.userId]},then:memberJoinedAt(group,idOf(member.userId))}));
  const weekStartDay=require('../services/daily-rules').dayKey(weekStart);
  const activityDateExpr={$cond:[{$ne:[{$ifNull:['$startTime',null]},null]},'$startTime',{$dateFromString:{dateString:{$concat:[{$ifNull:['$activityDate','']},'T00:00:00+05:30']},onError:'$recordedAt'}}]};
  const rows=await require('./health.model').HealthRecord.aggregate([
   {$match:{userId:{$in:members.map(member=>member.userId)},metricType:'steps',deleted:{$ne:true},$or:[{recordedAt:{$gte:weekStart}},{activityDate:{$gte:weekStartDay}}]}},
   {$addFields:{membershipStart:{$switch:{branches,default:new Date()}},activityStartAt:activityDateExpr}},
   {$match:{$expr:{$and:[{$gte:['$activityStartAt',weekStart]},{$gte:['$activityStartAt','$membershipStart']}]}}},
   {$group:{_id:'$userId',steps:{$sum:'$value'},days:{$addToSet:{$ifNull:['$activityDate',{$dateToString:{date:'$activityStartAt',format:'%Y-%m-%d',timezone:'Asia/Kolkata'}}]}}}},
  ]);
  for(const row of rows)totals.set(String(row._id),{steps:row.steps,days:row.days.filter(Boolean).length});
 }else{
  for(const row of require('./health.model').healthRecords){
   const memberId=String(row.user_id),member=members.find(entry=>idOf(entry.userId||entry)===memberId);
   const record=require('./health.model').toHealthRecord(row),activityAt=activityStartAt(record);
   if(member&&row.metric_type==='steps'&&activityAt>=weekStart&&activityAt>=memberJoinedAt(group,memberId)&&!row.deleted){
    const value=totals.get(memberId)||{steps:0,days:new Set()};value.steps+=Number(row.value);value.days.add(row.activityDate||require('../services/daily-rules').dayKey(activityAt));totals.set(memberId,value);
   }
  }
 }
 const all=await require('./user.model').listUsers();
 return ids.map((memberId,index)=>{const data=totals.get(memberId)||{steps:0,days:0},user=all.find(item=>String(item.id)===memberId);return {id:memberId,rank:0,name:user?.name||'Member',steps:data.steps,initials:(user?.name||'M').split(/\s+/).map(value=>value[0]).slice(0,2).join('').toUpperCase(),streak:`${data.days instanceof Set?data.days.size:data.days} active days`,color:['#FF8278','#579CF4','#00C6A2','#FF9B38','#8175F5'][index%5]};}).sort((a,b)=>b.steps-a.steps).map((row,index)=>({...row,rank:index+1}));
}
function validActivityDay(day){const value=day||new Date(Date.now()+330*60000).toISOString().slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(+new Date(`${value}T00:00:00Z`))||new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)!==value)throw new AppError('day must be a valid YYYY-MM-DD date',400);return value;}
async function activityForGroups(groups,day){
 const ids=[...new Set(groups.flatMap(group=>(group.members||[]).map(member=>idOf(member.userId||member))))];let records=[];
 if(ids.length){
  if(env.useMongoDB){const start=new Date(`${day}T00:00:00+05:30`),end=new Date(+start+86400000);records=await require('./health.model').HealthRecord.find({userId:{$in:ids},deleted:{$ne:true},$or:[{activityDate:day},{activityDate:{$exists:false},recordedAt:{$gte:start,$lt:end}}]}).lean().then(rows=>rows.map(require('./health.model').toHealthRecord));}
  else {const start=new Date(`${day}T00:00:00+05:30`),end=new Date(+start+86400000);records=require('./health.model').healthRecords.filter(row=>ids.includes(String(row.user_id))&&!row.deleted&&(row.activityDate===day||(!row.activityDate&&new Date(row.recorded_at)>=start&&new Date(row.recorded_at)<end))).map(require('./health.model').toHealthRecord);}
 }
 const users=await require('./user.model').listUsers(),byId=new Map(users.map(user=>[String(user.id),user]));const ruleSet=require('../services/daily-rules');const output=groups.map(group=>{
  const members=(group.members||[]).map(member=>{const userId=idOf(member.userId||member),user=byId.get(userId),membershipStart=memberJoinedAt(group,userId),rows=records.filter(row=>String(row.userId||row.user_id)===userId&&activityStartAt(row)>=membershipStart),activityRows=rows.filter(row=>['steps','workout','meditation','water_checkin','sleep_checkin','active_minutes','walking','running'].includes(row.metricType)),totals=ruleSet.calculate(rows);return {id:userId,name:user?.name||'Member',publicId:user?.publicId||null,role:userId===idOf(group.createdBy)?'GL':'MEMBER',active:activityRows.length>0,recordCount:rows.length,steps:totals.steps,workoutMinutes:Number(totals.workoutMinutes.toFixed(2)),meditationMinutes:Number(totals.meditationMinutes.toFixed(2)),entitledPoints:totals.entitledCoins,activityCount:activityRows.length,joinedAt:membershipStart};});
  const sum=key=>members.reduce((total,member)=>total+Number(member[key]||0),0);return {id:idOf(group),name:group.name,imageUrl:group.imageUrl||null,emoji:group.emoji||'🏃',private:Boolean(group.isPrivate??group.private),leaderId:idOf(group.createdBy),leaderName:byId.get(idOf(group.createdBy))?.name||'Member',memberCount:members.length,maxMembers:GROUP_MEMBER_LIMIT,activeMembers:members.filter(member=>member.active).length,steps:sum('steps'),workoutMinutes:Number(sum('workoutMinutes').toFixed(2)),meditationMinutes:Number(sum('meditationMinutes').toFixed(2)),entitledPoints:sum('entitledPoints'),members};
 });return {day,timezone:'Asia/Kolkata',groups:output};
}
async function groupDailyActivity(id,userId,day){const group=await findGroup(id);if(!group)throw new AppError('Group not found',404);if(!(group.members||[]).some(member=>idOf(member.userId||member)===String(userId)))throw new AppError('Join the group to view its activity',403);day=validActivityDay(day);const result=await activityForGroups([group],day);return result.groups[0];}
async function groupRankings(day,admin=false){day=validActivityDay(day);let groups;if(admin){groups=env.useMongoDB?await Group.find({deletedAt:null}).lean():memoryGroups.filter(group=>!group.deletedAt);}else groups=await listGroups('',true);const data=await activityForGroups(groups,day);const ranked=data.groups.sort((a,b)=>b.steps-a.steps||b.activeMembers-a.activeMembers||a.name.localeCompare(b.name)).map((group,index)=>{const rankedGroup={...group,rank:index+1};if(!admin){delete rankedGroup.members;delete rankedGroup.leaderId;}return rankedGroup;});return {day,timezone:data.timezone,groups:ranked};}
async function getBadges(userId){let rows;if(env.useMongoDB)rows=await require('./health.model').HealthRecord.aggregate([{$match:{userId:new mongoose.Types.ObjectId(userId),deleted:{$ne:true}}},{$group:{_id:null,steps:{$sum:{$cond:[{$eq:['$metricType','steps']},'$value',0]}},activeDays:{$addToSet:'$activityDate'},waters:{$sum:{$cond:[{$eq:['$metricType','water_checkin']},1,0]}},earlyWorkouts:{$sum:{$cond:[{$and:[{$eq:['$metricType','workout']},{$ne:['$startTime',null]}]},{$cond:[{$lt:[{$hour:{date:'$startTime',timezone:'Asia/Kolkata'}},9]},1,0]},0]}}}}]);else{const records=require('./health.model').healthRecords.filter(r=>String(r.user_id)===String(userId)&&!r.deleted);rows=[{steps:records.filter(r=>r.metric_type==='steps').reduce((s,r)=>s+Number(r.value),0),activeDays:new Set(records.map(r=>r.activityDate).filter(Boolean)),waters:records.filter(r=>r.metric_type==='water_checkin').length,earlyWorkouts:records.filter(r=>r.metric_type==='workout'&&r.startTime&&(new Date(+new Date(r.startTime)+330*60000).getUTCHours()<9)).length}];}const data=rows[0]||{};const days=data.activeDays instanceof Set?data.activeDays.size:(data.activeDays||[]).filter(Boolean).length;return [{id:'streak-master',title:'Streak Master',subtitle:'10 active days',emoji:'🔥',earned:days>=10},{id:'step-champion',title:'Step Champion',subtitle:'100K synced steps',emoji:'👟',earned:(data.steps||0)>=100000},{id:'hydrated-hero',title:'Hydrated Hero',subtitle:'7 water check-ins',emoji:'💧',earned:(data.waters||0)>=7},{id:'early-bird',title:'Early Bird',subtitle:'5 morning workouts',emoji:'🌅',earned:(data.earlyWorkouts||0)>=5},{id:'iron-will',title:'Iron Will',subtitle:'30 active days',emoji:'💪',earned:days>=30}];}
module.exports={Group,Message,Challenge,GROUP_MEMBER_LIMIT,createGroup,listGroups,joinGroup,addGroupMember,leaveGroup,deleteGroup,getGroup,updateGroup,groupLeaderboard,groupDailyActivity,groupRankings,getBadges,postMessage,listMessages,listFeed,createChallenge,findChallenge,listChallenges,joinChallenge,memberJoinedAt,activityStartAt,memoryGroups,memoryChallenges};
