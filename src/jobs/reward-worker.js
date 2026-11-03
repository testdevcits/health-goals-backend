const env=require('../config/env');
const engine=require('../services/reward-engine.service');
let timer=null,inFlight=null;
function start(){if(timer||!env.useMongoDB)return;const tick=()=>{if(inFlight)return;inFlight=engine.evaluate().catch(error=>console.error('Reward evaluation failed:',error.code||error.name)).finally(()=>{inFlight=null;});};timer=setInterval(tick,30000);timer.unref();tick();}
async function stop(){if(timer)clearInterval(timer);timer=null;await inFlight;}
module.exports={start,stop};
