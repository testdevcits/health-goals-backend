const { test } = require('node:test');
const assert = require('node:assert/strict');
if (process.env.HEALTH_SYNC_MONGO_TEST !== 'true') {
  test('health sync Mongo integration requires HEALTH_SYNC_MONGO_TEST=true', { skip: true }, () => {});
} else {
  const mongoose = require('mongoose');
  const env = require('../src/config/env');
  const { ingest } = require('../src/services/activity-ingestion.service');
  const { HealthRecord } = require('../src/models/health.model');
  const { chart } = require('../src/services/record-chart.service');
  const { randomUUID } = require('crypto');
  test('Mongo transactions supersede legacy steps and charts preserve IST days and BP components', async () => {
    // Always use a fresh test database, never the configured application database.
    const dbName = `hs_test_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
    await mongoose.connect(env.mongoUri, { dbName, serverSelectionTimeoutMS: 10000 });
    try {
      assert.equal(mongoose.connection.name, dbName);
      await Promise.all(Object.values(mongoose.models).map(model => model.init()));
      const userId = String(new mongoose.Types.ObjectId());
      const day = '2024-01-04';
      const common = { metricType: 'steps', unit: 'count', source: 'health_connect', recordedAt: `${day}T00:00:00+05:30`, startTime: `${day}T00:00:00+05:30`, endTime: `${day}T23:59:59+05:30`, dataOrigin: 'phone', recordingMethod: 'automatic' };
      await ingest(userId, { ...common, value: 4000, sourceRecordId: `daily-steps:${day}:phone` });
      await ingest(userId, { ...common, value: 4100, sourceRecordId: `daily-steps:${day}:watch` });
      const payload = { ...common, value: 4200, sourceRecordId: `daily-steps:${day}:aggregate`, sourceVersion: 100, metadata: { aggregation: 'daily_total', aggregationScope: 'health_connect' } };
      await ingest(userId, payload);
      assert.equal((await ingest(userId, payload)).duplicate, true);
      const result = await chart(userId, { from: day, to: day });
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].value, 4200);
      assert.equal(result.items[0].day, day);
      await ingest(userId, { ...common, value: 8000, sourceRecordId: `daily-steps:${day}:phone`, sourceVersion: 1000 });
      assert.equal((await chart(userId, { from: day, to: day })).items[0].value, 4200);
      assert.equal(await HealthRecord.countDocuments({ userId, deleted: true }), 2);
      assert.equal(await HealthRecord.countDocuments({ userId }), 3);
      for (const [component, value] of [['systolic', 120], ['diastolic', 80]]) {
        await ingest(userId, { metricType: 'blood_pressure', unit: 'mmHg', value, source: 'health_connect', sourceRecordId: component, recordedAt: `${day}T00:00:00+05:30`, metadata: { component } });
      }
      const bp = await chart(userId, { metricType: 'blood_pressure', from: day, to: day });
      assert.equal(bp.items.length, 2);
      assert.equal(bp.items.find(row => row.component === 'systolic').value, 120);
      assert.equal(bp.items.find(row => row.component === 'diastolic').value, 80);
      const service = require('../src/services/health.service');
      const { METRIC_UNITS } = require('../src/services/health-metrics');
      const allUser = String(new mongoose.Types.ObjectId());
      const all = Object.entries(METRIC_UNITS).map(([metricType,unit]) => ({ metricType,unit,value:({heart_rate:70,weight:75,blood_pressure:120,oxygen_saturation:98,water_checkin:1,sleep_checkin:1})[metricType]||30, source:'app',sourceRecordId:`all:${metricType}`,sourceVersion:1,recordedAt:`${day}T01:00:00+05:30`,...(['workout','meditation'].includes(metricType)?{startTime:`${day}T01:00:00+05:30`,endTime:`${day}T01:30:00+05:30`,activityType:'cycling'}:{}),...(metricType==='blood_pressure'?{metadata:{component:'systolic'}}:{}) }));
      let identityReads=0; const originalFind=HealthRecord.find;
      HealthRecord.find=function(...args){identityReads++;return originalFind.apply(this,args);};
      try { assert.equal((await service.syncRecords(allUser,{records:all,includeRecords:false})).created,all.length); }
      finally { HealthRecord.find=originalFind; }
      assert.equal(identityReads,1);
      assert.equal((await chart(allUser)).items.length,all.length);
      assert.equal((await service.getRecordsPage(allUser,{limit:'10'})).records.length,10);
      assert.equal((await service.getDashboard(allUser)).latestRecords.length,all.length);
      const changed={...all[0],value:999,sourceVersion:2};
      const conflict={...all[1],sourceVersion:2,recordedAt:'2024-01-05T01:00:00+05:30'};
      await assert.rejects(()=>service.syncRecords(allUser,{records:[changed,conflict]}));
      assert.equal((await HealthRecord.findOne({userId:allUser,sourceRecordId:changed.sourceRecordId})).value,all[0].value);
      await service.syncRecords(allUser,{records:all.map(row=>({...row,sourceVersion:3,deleted:true}))});
      assert.equal((await chart(allUser)).items.length,0);
      assert.deepEqual(await service.getSummary(allUser),{});
      assert.equal((await service.getDashboard(allUser)).latestRecords.length,0);

    } finally {
      // This database was created exclusively by this test invocation.
      try {
        if (mongoose.connection.name === dbName) await mongoose.connection.dropDatabase();
      } finally { await mongoose.disconnect(); }
    }
  });
}
