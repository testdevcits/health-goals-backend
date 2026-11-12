#!/usr/bin/env node
'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const args = new Set(process.argv.slice(2));
const execute = args.has('--execute');
const allowProduction = args.has('--allow-production');
const confirmArg = process.argv.slice(2).find(value => value.startsWith('--confirm-db='));
const confirmedDatabase = confirmArg?.slice('--confirm-db='.length) || '';
const uri = process.env.MONGODB_URI;

function targetFromUri() {
  if (!uri) throw new Error('MONGODB_URI is missing. Add it to backend/.env.');
  const parsed = new URL(uri);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, '').split('/')[0] || '');
  if (!database) throw new Error('MONGODB_URI must include an explicit database name.');
  return { database, host: parsed.hostname };
}

async function main() {
  const target = targetFromUri();
  if (process.env.USE_MONGODB === 'false') throw new Error('USE_MONGODB=false; refusing to run.');
  if (process.env.NODE_ENV === 'production' && !allowProduction) {
    throw new Error('NODE_ENV=production. Refusing to reset without --allow-production.');
  }
  if (execute && confirmedDatabase !== target.database) {
    throw new Error(`Execution needs --confirm-db=${target.database} to match the selected database.`);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;
  const collections = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map(item => item.name).filter(name => !name.startsWith('system.')).sort();
  console.log(`Target MongoDB: ${target.host}/${target.database}`);
  console.log(`Mode: ${execute ? 'EXECUTE — all documents, including users, will be deleted' : 'DRY RUN — no data will be changed'}`);
  for (const name of collections) {
    const count = await db.collection(name).countDocuments({});
    console.log(`  ${name}: ${count} document(s)${execute ? '' : ' (would delete)'}`);
  }
  if (!execute) {
    console.log('\nDry run complete. To delete all data, run:');
    console.log(`node scripts/reset-db.js --execute --confirm-db=${target.database}`);
    return;
  }
  for (const name of collections) {
    const result = await db.collection(name).deleteMany({});
    console.log(`Deleted ${name}: ${result.deletedCount} document(s).`);
  }
  console.log('Database reset complete. All documents were deleted; collection indexes remain.');
}

main()
  .catch(error => { console.error(`Database reset stopped: ${error.message}`); process.exitCode = 1; })
  .finally(async () => { if (mongoose.connection.readyState !== 0) await mongoose.disconnect(); });
