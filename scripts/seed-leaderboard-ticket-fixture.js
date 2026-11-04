// Development-only fixture for testing completed-month leaderboard ticket rewards.
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const env = require('../src/config/env');
const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const users = require('../src/models/user.model');
const devices = require('../src/models/device.model');
const community = require('../src/models/community.model');
const { HealthRecord } = require('../src/models/health.model');

const people = [
  { name: 'Aarav Fitness', email: 'fixture.aarav@example.test', days: [{ steps: 12400, workout: 42, meditation: 10 }, { steps: 11800, workout: 30, meditation: 8 }, { steps: 13600, workout: 45, meditation: 10 }] },
  { name: 'Meera Wellness', email: 'fixture.meera@example.test', days: [{ steps: 9800, workout: 25, meditation: 12 }, { steps: 10600, workout: 35, meditation: 10 }, { steps: 9400, workout: 28, meditation: 12 }] },
  { name: 'Kabir Active', email: 'fixture.kabir@example.test', days: [{ steps: 8200, workout: 20, meditation: 5 }, { steps: 8700, workout: 22, meditation: 5 }, { steps: 9100, workout: 25, meditation: 6 }] }
];
const dates = ['2026-10-27', '2026-10-28', '2026-10-29'];

async function getUser(person) {
  let user = await users.findUserByEmail(person.email);
  if (!user) user = await users.createUser({ name: person.name, email: person.email, passwordHash: await bcrypt.hash(crypto.randomBytes(28).toString('hex'), 4) });
  const device = await devices.createDevice(user.id, { deviceType: 'phone', deviceIdentifier: `ticket-fixture-${person.email}`, manufacturer: 'Health App', model: 'Leaderboard fixture', platform: 'android' });
  return { ...user, deviceId: device.id };
}
const at = (day, hour, minute = 0) => new Date(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:30`).toISOString();

function activityOperations(user, person, index) {
  const day = dates[index]; const values = person.days[index];
  const rows = [
    { metricType: 'steps', value: values.steps, unit: 'count', startTime: at(day, 7), endTime: at(day, 8) },
    { metricType: 'workout', value: values.workout, unit: 'min', activityType: 'walking', startTime: at(day, 18), endTime: at(day, 18, values.workout) },
    { metricType: 'meditation', value: values.meditation, unit: 'min', startTime: at(day, 21), endTime: at(day, 21, values.meditation) },
    { metricType: 'water_checkin', value: 1, unit: 'checkin' },
    { metricType: 'sleep_checkin', value: 1, unit: 'checkin' }
  ];
  return rows.map(row => {
    const source = row.metricType === 'steps' ? 'health_connect' : 'app';
    const sourceRecordId = `ticket-fixture-v1:${person.email}:${day}:${row.metricType}`;
    return { updateOne: { filter: { userId: user.id, source, sourceRecordId }, update: { $setOnInsert: { ...row, userId: user.id, recordedAt: row.startTime || at(day, 12), source, sourceRecordId, sourceVersion: 1, deviceId: user.deviceId, activityDate: day, deleted: false, metadata: { fixture: true, purpose: 'leaderboard-ticket-reward' } } }, upsert: true } };
  });
}

async function main() {
  if (!env.useMongoDB || env.appMode !== 'dev' || env.nodeEnv === 'production') throw new Error('Fixture seeding requires persistent MongoDB and APP_MODE=dev outside production.');
  await connectDatabase();
  console.log('Preparing fixture users…');
  const seededUsers = [];
  for (const person of people) seededUsers.push(await getUser(person));
  console.log('Preparing fixture group…');
  let group = await community.Group.findOne({ name: 'October Activity Champions', createdBy: seededUsers[0].id }).lean();
  if (!group) { const created = await community.createGroup(seededUsers[0].id, { name: 'October Activity Champions', description: 'Synthetic group for ticket reward testing', private: true, maxMembers: 10 }); group = { _id: created.id }; }
  for (const user of seededUsers.slice(1)) await community.addGroupMember(String(group._id), seededUsers[0].id, user.id);
  console.log('Writing October activity records…');
  const operations = [];
  for (let index = 0; index < dates.length; index++) for (let personIndex = 0; personIndex < people.length; personIndex++) operations.push(...activityOperations(seededUsers[personIndex], people[personIndex], index));
  await HealthRecord.bulkWrite(operations, { ordered: false });
  console.log(JSON.stringify({ month: '2026-10', group: 'October Activity Champions', users: seededUsers.map(user => ({ name: user.name, email: user.email })), activityDays: dates, note: 'Fixture is idempotent. Use October 2026 in Leaderboard tickets to create a new winner claim.' }, null, 2));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => disconnectDatabase());
