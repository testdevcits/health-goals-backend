// Product incentives, not a medical score. Store a snapshot on every user/day.
const RULES = Object.freeze({ version: 'daily-v1', timezone: 'Asia/Kolkata', dailyCap: 20,
  stepsPerTier: 2000, stepTierCoins: 2, stepMaxCoins: 8,
  workoutMinutes: 20, workoutCoins: 5, meditationMinutes: 5, meditationCoins: 2,
  waterCheckinCoins: 1, sleepCheckinCoins: 2 });
const OFFSET = 330 * 60000;
function dayKey(value) { return new Date(new Date(value).getTime()+OFFSET).toISOString().slice(0,10); }
function dayEnd(day) { return new Date(new Date(`${day}T00:00:00Z`).getTime()+86400000-OFFSET); }
// Conservative overlap handling: overlapping records form one cluster; use its
// largest count, not a sum. Across devices/apps use one origin's daily total.
function stepTotal(records) {
  const origins = new Map();
  for(const r of records.filter(r=>r.metricType==='steps'&&r.startTime&&r.endTime&&r.dataOrigin&&['health_connect','app'].includes(r.source)&&['automatic','active'].includes(r.recordingMethod))) {
    const key=`${r.source}:${r.dataOrigin}`; if(!origins.has(key))origins.set(key,[]);origins.get(key).push(r);
  }
  let total=0;
  for(const rows of origins.values()) {
    rows.sort((a,b)=>new Date(a.startTime)-new Date(b.startTime));
    let count=0,end=0,best=0;
    for(const row of rows){const start=+new Date(row.startTime),stop=+new Date(row.endTime);if(start<end){best=Math.max(best,row.value);end=Math.max(end,stop);}else{count+=best;best=row.value;end=stop;}}
    total=Math.max(total,count+best);
  }
  return total;
}
function minutes(records,metric) {
  const rows=records.filter(r=>r.metricType===metric&&r.startTime&&r.endTime&&(metric!=='workout'||!['walking','running','hiking','treadmill'].includes(r.activityType))).sort((a,b)=>new Date(a.startTime)-new Date(b.startTime));
  let total=0,lastEnd=0;
  for(const r of rows){const start=+new Date(r.startTime),end=+new Date(r.endTime);total+=Math.max(0,end-Math.max(start,lastEnd));lastEnd=Math.max(lastEnd,end);}
  return total/60000;
}
function calculate(records,rules=RULES) {
  const steps=stepTotal(records),workoutMinutes=minutes(records,'workout'),meditationMinutes=minutes(records,'meditation');
  const breakdown={steps:Math.min(rules.stepMaxCoins,Math.floor(steps/rules.stepsPerTier)*rules.stepTierCoins),
    workout:workoutMinutes>=rules.workoutMinutes?rules.workoutCoins:0,
    meditation:meditationMinutes>=rules.meditationMinutes?rules.meditationCoins:0,
    waterCheckin:records.some(r=>r.metricType==='water_checkin'&&r.value===1)?rules.waterCheckinCoins:0,
    sleepCheckin:records.some(r=>r.metricType==='sleep_checkin'&&r.value===1)?rules.sleepCheckinCoins:0};
  return {steps,workoutMinutes,meditationMinutes,breakdown,entitledCoins:Math.min(rules.dailyCap,Object.values(breakdown).reduce((a,b)=>a+b,0))};
}
module.exports={RULES,dayKey,dayEnd,calculate};
