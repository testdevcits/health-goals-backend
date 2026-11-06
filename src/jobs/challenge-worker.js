const env=require('../config/env');
const service=require('../services/challenge.service');
let timer=null,inFlight=null;
function tick(){if(inFlight)return;inFlight=service.evaluate().catch(error=>console.error('Challenge finalization failed:',error.code||error.name)).finally(()=>{inFlight=null;});}
function start(){if(timer||!env.useMongoDB)return;timer=setInterval(tick,30000);timer.unref();tick();}
async function stop(){if(timer)clearInterval(timer);timer=null;await inFlight;}
module.exports={start,stop,tick};
