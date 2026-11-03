const env=require('../config/env');
const daily=require('../services/daily-settlement.service');
let timer=null,running=false,inFlight=Promise.resolve();
function start(){
 if(timer||!env.settlementEnabled)return;
 if(!env.useMongoDB){console.warn('Persistent points settlement worker disabled: MongoDB is required.');return;}
 const tick=()=>{
  if(running)return;running=true;
  inFlight=daily.processBatch({batchSize:20,concurrency:2}).catch(error=>console.error('Settlement worker failed:',error.code||error.name)).finally(()=>{running=false;});
 };
 timer=setInterval(tick,15000);timer.unref();tick();
 console.log('Daily point settlement enabled: midnight Asia/Kolkata; batches of 20, concurrency 2.');
}
async function stop(){if(timer)clearInterval(timer);timer=null;await inFlight;}
module.exports={start,stop};
