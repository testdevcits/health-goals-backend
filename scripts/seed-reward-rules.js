const env=require('../src/config/env');
const {connectDatabase,disconnectDatabase}=require('../src/config/database');
const users=require('../src/models/user.model');
const rules=require('../src/services/reward-rule.service');
const defaults=[
 {seedKey:'default-monthly-steps-leaderboard',title:'Monthly Steps Challenge',ruleType:'LEADERBOARD',audience:'INDIVIDUAL',metric:'STEPS',targetValue:100000,period:'MONTHLY',winnersCount:3,badgeTitle:'Monthly Step Champion',bonusPoints:0,status:'ACTIVE'},
 {seedKey:'default-monthly-steps-badge',title:'Monthly Steps Badge Goal',ruleType:'BADGE',audience:'INDIVIDUAL',metric:'STEPS',targetValue:100000,period:'MONTHLY',winnersCount:1,badgeTitle:'Monthly Steps Achiever',bonusPoints:0,status:'ACTIVE'},
 {seedKey:'default-seven-day-steps-challenge',title:'7-Day Steps Challenge',ruleType:'CHALLENGE',audience:'INDIVIDUAL',metric:'STEPS',targetValue:50000,period:'DURATION',durationDays:7,winnersCount:1,badgeTitle:'7-Day Step Finisher',bonusPoints:0,status:'ACTIVE'}
];
function groupDefaults(groups){
 return groups.flatMap(group=>[
  {key:'leaderboard',title:'Monthly Group Steps Leaderboard',ruleType:'LEADERBOARD',targetValue:1000000,period:'MONTHLY',winnersCount:3,badgeTitle:'Monthly Group Champion'},
  {key:'badge',title:'Monthly Group Steps Badge Goal',ruleType:'BADGE',targetValue:1000000,period:'MONTHLY',winnersCount:1,badgeTitle:'Group Steps Achiever'},
  {key:'challenge',title:'7-Day Group Steps Challenge',ruleType:'CHALLENGE',targetValue:250000,period:'DURATION',durationDays:7,winnersCount:1,badgeTitle:'Group Challenge Finisher'}
 ].map(({key,title,...definition})=>({...definition,seedKey:`default-group-${group.id}-${key}`,title:`${title} · ${group.name}`.slice(0,100),audience:'GROUP',targetGroupId:group.id,metric:'STEPS',bonusPoints:0,status:'ACTIVE'})));
}
async function seedDefaults(adminId,service=rules,groups=[]){
 const results=[];
 for(const {seedKey,...definition} of [...defaults,...groupDefaults(groups)]){
  // Adopt the older seed by name once; subsequent runs use a stable identity.
  let existing=await service.RewardRule.findOne({seedKey}).lean();
  if(!existing)existing=await service.RewardRule.findOne({title:definition.title,ruleType:definition.ruleType,audience:definition.audience,targetGroupId:definition.targetGroupId??null,seedKey:{$exists:false}}).lean();
  const body={...definition,targetUserId:null,targetGroupId:definition.targetGroupId??null,durationDays:definition.durationDays??null};
  let saved;
  try{saved=existing?await service.update(String(existing._id),body,adminId):await service.create(body,adminId);}
  catch(error){
   if(existing||error.statusCode!==409)throw error;
   // Adopt an identical existing configuration instead of creating a duplicate.
   const candidate=(await service.list()).items.find(row=>Object.entries(body).every(([key,value])=>(row[key]??null)===value));
   if(!candidate)throw error;
   saved=await service.update(candidate.id,body,adminId);
  }
  await service.RewardRule.updateOne({_id:saved.id},{$set:{seedKey}});
  results.push({id:saved.id,title:saved.title});
 }
 return results;
}
async function main(){
 if(!env.useMongoDB)throw new Error('Reward rule seeding requires persistent MongoDB.');
 await connectDatabase();
 const admin=await users.User.findOne({email:{$in:env.adminEmails}}).select('_id').lean();
 if(!admin)throw new Error('No configured admin account found. Create an admin account first.');
 const {groups}=await rules.options();
 if(!groups.length)console.log('No groups found: group defaults skipped. Create a group and run this seed again.');
 for(const rule of await seedDefaults(String(admin._id),rules,groups))console.log(`Default reward rule saved: ${rule.title}`);
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>disconnectDatabase());
module.exports={defaults,groupDefaults,seedDefaults};
