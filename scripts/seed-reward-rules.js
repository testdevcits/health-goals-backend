const env=require('../src/config/env');
const {connectDatabase,disconnectDatabase}=require('../src/config/database');
const users=require('../src/models/user.model');
const rules=require('../src/services/reward-rule.service');
async function main(){
 if(!env.useMongoDB)throw new Error('Reward rule seeding requires persistent MongoDB.');
 await connectDatabase();
 const admin=await users.User.findOne({email:{$in:env.adminEmails}}).select('_id').lean();
 if(!admin)throw new Error('No configured admin account found. Create an admin account first.');
 try{
 const rule=await rules.create({title:'Monthly Steps Challenge',ruleType:'LEADERBOARD',audience:'INDIVIDUAL',metric:'STEPS',targetValue:100000,period:'MONTHLY',winnersCount:3,badgeTitle:'Monthly Step Champion',bonusPoints:0,status:'ACTIVE'},String(admin._id));
 console.log(`Default reward rule created: ${rule.title}`);
 }catch(error){if(error.statusCode===409||error.status===409)console.log('Default reward rule already exists; skipped.');else throw error;}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>disconnectDatabase());
