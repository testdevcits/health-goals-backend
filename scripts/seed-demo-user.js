// Idempotent local/demo fixture. No emails are sent and no real account is edited.
const crypto=require('crypto');
const bcrypt=require('bcrypt');
const mongoose=require('mongoose');
const env=require('../src/config/env');
const {connectDatabase,disconnectDatabase}=require('../src/config/database');
const users=require('../src/models/user.model');
const devices=require('../src/models/device.model');
const health=require('../src/services/health.service');
const daily=require('../src/services/daily-settlement.service');
const {DailyActivity}=require('../src/models/daily-activity.model');
const {dayKey}=require('../src/services/daily-rules');
const wallet=require('../src/models/wallet.model');
const EMAIL='demo.health.user@example.test';
async function main(){
 if(!env.useMongoDB||env.appMode!=='dev'||env.nodeEnv==='production')throw new Error('Demo seeding requires persistent MongoDB and APP_MODE=dev outside production.');
 if(env.adminEmails.includes(EMAIL))throw new Error('Demo email must not be an admin.');
 await connectDatabase();
 let user=await users.findUserByEmail(EMAIL);
 if(!user)user=await users.createUser({name:'Demo User · Sample Data',email:EMAIL,passwordHash:await bcrypt.hash(crypto.randomBytes(32).toString('hex'),12)});
 const userId=user.id;
 const device=await devices.createDevice(userId,{deviceType:'phone',deviceIdentifier:'demo-health-android-phone-v1',manufacturer:'Demo device',model:'Demo Android Phone',platform:'android'});
 const today=dayKey(new Date());let processed=0,credited=0;
 for(let i=7;i>=1;i--){
  const day=new Date(new Date(`${today}T00:00:00Z`).getTime()-i*86400000).toISOString().slice(0,10);
  const at=(hour,minute=0)=>new Date(`${day}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00+05:30`).toISOString();
  const steps=[2400,4200,6500,8100,5400,9200,7200][7-i];
  const rows=[
   {metricType:'steps',value:steps,unit:'count',startTime:at(7),endTime:at(8),dataOrigin:'com.healthapp.demo',recordingMethod:'automatic'},
   {metricType:'workout',value:20,unit:'min',startTime:at(9),endTime:at(9,20),activityType:'cycling',recordingMethod:'active'},
   {metricType:'meditation',value:5,unit:'min',startTime:at(10),endTime:at(10,5),recordingMethod:'active'},
   {metricType:'water_checkin',value:1,unit:'checkin'},
   {metricType:'sleep_checkin',value:1,unit:'checkin'},
   {metricType:'heart_rate',value:68+(i%5)*3,unit:'bpm'},
   {metricType:'sleep',value:420+(i%3)*20,unit:'min'},
   {metricType:'weight',value:72+i/10,unit:'kg'},
   {metricType:'distance',value:Number((steps*0.0007).toFixed(2)),unit:'km'},
   {metricType:'calories',value:200+i*15,unit:'kcal'},
   {metricType:'oxygen_saturation',value:97+i%2,unit:'percent'}
  ];
  for(const row of rows){await health.createRecord(userId,{...row,recordedAt:row.startTime||at(12),source:['steps','heart_rate','sleep','weight','distance','calories','oxygen_saturation'].includes(row.metricType)?'health_connect':'app',sourceRecordId:`demo-v1:${day}:${row.metricType}`,sourceVersion:1,deviceId:device.id,metadata:{demo:true,synthetic:true,note:'Synthetic preview data; not real health measurements'}});processed++;}
  // Settle only this demo user's historical day; never process other users.
  const now=new Date(),leaseToken=crypto.randomUUID();
  const job=await DailyActivity.findOneAndUpdate({userId,day,dueAt:{$lte:now},lockUntil:{$lte:now},$expr:{$gt:['$revision','$settledRevision']}},{$set:{leaseToken,lockUntil:new Date(+now+120000),state:'PROCESSING'},$inc:{attempts:1}},{new:true}).lean();
  if(job)credited+=(await daily.settle(job,now))?.credited||0;
 }
 // A pending activity today demonstrates the midnight settlement boundary.
 await health.createRecord(userId,{metricType:'water_checkin',value:1,unit:'checkin',recordedAt:new Date().toISOString(),source:'app',sourceRecordId:`demo-v1:${today}:water_checkin`,deviceId:device.id,metadata:{demo:true,synthetic:true}});
 const recordCount=await mongoose.model('HealthRecord').countDocuments({userId});
 const balance=await wallet.findWallet(userId);
 console.log(JSON.stringify({name:user.name,email:EMAIL,records:recordCount,devices:1,historicalDays:7,creditedThisRun:credited,availableCoins:balance.availablePoints,todayPending:(await daily.progress(userId)).pendingCoins},null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>disconnectDatabase());
