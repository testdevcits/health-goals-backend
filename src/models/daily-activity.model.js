const mongoose=require('mongoose');
const schema=new mongoose.Schema({
 userId:{type:mongoose.Schema.Types.ObjectId,required:true,ref:'User'},day:{type:String,required:true},
 rules:{type:mongoose.Schema.Types.Mixed,required:true},revision:{type:Number,default:0},settledRevision:{type:Number,default:0},
 dueAt:{type:Date,required:true},nextAttemptAt:{type:Date,required:true},lockUntil:{type:Date,default:()=>new Date(0)},leaseToken:String,
 state:{type:String,enum:['PENDING','PROCESSING','SETTLED','RETRY'],default:'PENDING'},attempts:{type:Number,default:0},
 creditedCoins:{type:Number,default:0},entitledCoins:{type:Number,default:0},totals:mongoose.Schema.Types.Mixed,
 lastSettledAt:Date,lastError:String
},{timestamps:true});
schema.index({userId:1,day:1},{unique:true});
schema.index({state:1,dueAt:1,nextAttemptAt:1,lockUntil:1});
schema.index({userId:1,day:-1});
const DailyActivity=mongoose.model('DailyActivity',schema);
module.exports={DailyActivity,memoryDays:new Map()};
