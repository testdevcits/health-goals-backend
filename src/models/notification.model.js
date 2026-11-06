const mongoose = require('mongoose');
const env = require('../config/env');
const crypto = require('crypto');
const schema = new mongoose.Schema({ userId:{type:String,required:true,index:true}, type:{type:String,required:true}, title:{type:String,required:true,maxlength:160}, body:{type:String,default:'',maxlength:500}, data:{type:mongoose.Schema.Types.Mixed,default:{}}, key:{type:String,required:true,unique:true}, readAt:{type:Date,default:null} },{timestamps:true});
schema.index({userId:1,createdAt:-1});
const Notification=mongoose.models.UserNotification||mongoose.model('UserNotification',schema);
const memory=[];
const dto=row=>({id:String(row._id||row.id),type:row.type,title:row.title,body:row.body||'',data:row.data||{},read:Boolean(row.readAt||row.read),createdAt:row.createdAt||row.created_at});
async function createForUser(userId,input){
 if(env.useMongoDB){try{return dto(await Notification.create({userId:String(userId),...input}));}catch(error){if(error.code===11000)return null;throw error;}}
 if(memory.some(row=>row.key===input.key))return null;
 const row={id:crypto.randomUUID(),userId:String(userId),...input,readAt:null,createdAt:new Date()};memory.unshift(row);return dto(row);
}
async function list(userId,{page=1,limit=50}={}){
 const safePage=Math.max(1,Number(page)||1),safeLimit=Math.min(100,Math.max(1,Number(limit)||50));
 const rows=env.useMongoDB?await Notification.find({userId:String(userId)}).sort({createdAt:-1,_id:-1}).skip((safePage-1)*safeLimit).limit(safeLimit).lean():memory.filter(row=>row.userId===String(userId)).slice((safePage-1)*safeLimit,safePage*safeLimit);
 const total=env.useMongoDB?await Notification.countDocuments({userId:String(userId)}):memory.filter(row=>row.userId===String(userId)).length;
 return {items:rows.map(dto),total,unread:env.useMongoDB?await Notification.countDocuments({userId:String(userId),readAt:null}):memory.filter(row=>row.userId===String(userId)&&!row.readAt).length,page:safePage,limit:safeLimit};
}
async function markRead(userId,id){
 if(env.useMongoDB){const row=await Notification.findOneAndUpdate({_id:id,userId:String(userId)},{$set:{readAt:new Date()}},{new:true}).lean();return row?dto(row):null;}
 const row=memory.find(item=>item.id===id&&item.userId===String(userId));if(!row)return null;row.readAt=new Date();return dto(row);
}
async function markAllRead(userId){if(env.useMongoDB){const result=await Notification.updateMany({userId:String(userId),readAt:null},{$set:{readAt:new Date()}});return {updated:result.modifiedCount||0};}let updated=0;for(const row of memory)if(row.userId===String(userId)&&!row.readAt){row.readAt=new Date();updated++;}return {updated};}
module.exports={Notification,createForUser,list,markRead,markAllRead,memory};
