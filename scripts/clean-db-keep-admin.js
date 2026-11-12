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
const configuredAdminEmails = (process.env.ADMIN_EMAILS || '')
  .split(',').map(email => email.trim().toLowerCase()).filter(Boolean);

function getDatabaseName() {
  if (!uri) throw new Error('MONGODB_URI is missing. Add it to backend/.env.');
  const parsed = new URL(uri);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, '').split('/')[0] || '');
  if (!name) throw new Error('MONGODB_URI must include an explicit database name in its path.');
  return { name, host: parsed.hostname };
}

async function main() {
  const target = getDatabaseName();
  if (process.env.USE_MONGODB === 'false') throw new Error('USE_MONGODB=false; refusing to run against a non-MongoDB setup.');
  if (process.env.NODE_ENV === 'production' && !allowProduction) {
    throw new Error('NODE_ENV=production. Refusing to clean; --allow-production is additionally required.');
  }
  if (execute && confirmedDatabase !== target.name) {
    throw new Error(`Execution needs --confirm-db=${target.name} to match the selected database.`);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;
  const collections = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map(collection => collection.name)
    .filter(name => !name.startsWith('system.'))
    .sort();
  const adminFilter = {
    $or: [
      { role: { $in: ['ADMIN', 'SUB_ADMIN'] } },
      ...(configuredAdminEmails.length ? [{ email: { $in: configuredAdminEmails } }] : [])
    ]
  };
  const userCollectionExists = collections.includes('users');
  const users = userCollectionExists ? db.collection('users') : null;
  const adminCount = users ? await users.countDocuments(adminFilter) : 0;
  const nonAdminCount = users ? await users.countDocuments({ $nor: [adminFilter] }) : 0;

  console.log(`Target MongoDB: ${target.host}/${target.name}`);
  console.log(`Mode: ${execute ? 'EXECUTE' : 'DRY RUN (no data will be changed)'}`);
  console.log(`Admin accounts to preserve: ${adminCount}`);
  console.log(`Non-admin user accounts to delete: ${nonAdminCount}`);
  if (!adminCount) throw new Error('No ADMIN or SUB_ADMIN account matched. Refusing to continue.');

  const dataCollections = collections.filter(name => name !== 'users');
  for (const name of dataCollections) {
    const count = await db.collection(name).countDocuments({});
    console.log(`  ${name}: ${count} document(s)${execute ? '' : ' (would clear)'}`);
  }

  if (!execute) {
    console.log('\nDry run complete. Review the collections above before executing.');
    console.log(`Run: node scripts/clean-db-keep-admin.js --execute --confirm-db=${target.name}`);
    return;
  }

  for (const name of dataCollections) {
    const result = await db.collection(name).deleteMany({});
    console.log(`Cleared ${name}: ${result.deletedCount} document(s).`);
  }
  const removedUsers = await users.deleteMany({ $nor: [adminFilter] });
  console.log(`Deleted non-admin users: ${removedUsers.deletedCount}.`);
  console.log(`Preserved admin accounts: ${await users.countDocuments(adminFilter)}.`);
  console.log('Database clean completed. Admin accounts remain; app/module data was cleared.');
}

main()
  .catch(error => {
    console.error(`Database clean stopped: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
