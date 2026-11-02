const crypto=require('crypto');
const {connectDatabase,disconnectDatabase}=require('../src/config/database');
const {User}=require('../src/models/user.model');
async function main(){
 await connectDatabase();let updated=0;
 // Native collection bypasses the immutable guard only for this backfill.
 const missing={$or:[{publicId:{$exists:false}},{publicId:null}]};
 for await(const user of User.find(missing).select('_id').lean().cursor()){
  for(let attempt=0;attempt<5;attempt++){
   try{const result=await User.collection.updateOne({_id:user._id,...missing},{$set:{publicId:`USR-${crypto.randomBytes(6).toString('hex').toUpperCase()}`}});updated+=result.modifiedCount;break;}
   catch(error){if(error.code!==11000||attempt===4)throw error;}
  }
 }
 console.log(JSON.stringify({userIdsAssigned:updated}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>disconnectDatabase());
