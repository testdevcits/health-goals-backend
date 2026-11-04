const mongoose = require('mongoose');
const env = require('../config/env');
const users = require('../models/user.model');
const health = require('../models/health.model');
const devices = require('../models/device.model');
const { AppError } = require('../middleware/error.middleware');
const configs = {
  users: { model: users.User, read: users.listUsers, time: 'createdAt', fields: ['name','email','publicId'], projection: '-passwordHash -refreshTokenHash', convert: users.toPublicUser },
  records: { model: health.HealthRecord, read: health.listAdmin, time: 'recordedAt', fields: ['metricType','source','sourceRecordId'], convert: row => ({ ...row, id: String(row._id), _id: undefined, __v: undefined }) },
  devices: { model: devices.Device, read: devices.listAdmin, time: 'createdAt', fields: ['model','manufacturer','deviceType','deviceIdentifier','platform'], convert: row => ({ ...row, id: String(row._id), _id: undefined, __v: undefined }) }
};
function integer(value, fallback, max) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > max) throw new AppError('Invalid pagination parameters',400);
  return Number(value);
}
function buildQuery(kind, params = {}) {
  const config = configs[kind];
  const page = integer(params.page,1,100000); const limit = integer(params.limit,20,100);
  const query = {};
  if (params.userId) {
    if (typeof params.userId !== 'string' || (env.useMongoDB && !mongoose.isValidObjectId(params.userId))) throw new AppError('Invalid user ID',400);
    query.userId = params.userId;
  }
  if (params.status) {
    if (!['ACTIVE','SUSPENDED','REMOVED'].includes(params.status)) throw new AppError('Invalid status',400);
    query.status = params.status;
  }
  if (params.metricType) {
    if (typeof params.metricType !== 'string' || params.metricType.length>40) throw new AppError('Invalid metric',400);
    query.metricType = params.metricType;
  }
  if (kind === 'devices') {
    for (const key of ['platform','model']) {
      if (!params[key]) continue;
      if (typeof params[key] !== 'string' || params[key].length > 150) throw new AppError(`Invalid device ${key}`,400);
      query[key] = params[key];
    }
  }
  for (const [key,operator,end] of [['from','$gte','T00:00:00.000Z'],['to','$lte','T23:59:59.999Z']]) {
    if (!params[key]) continue;
    if (typeof params[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(params[key])) throw new AppError('Invalid date filter',400);
    const date = new Date(params[key]+end);
    if (Number.isNaN(+date) || date.toISOString().slice(0,10)!==params[key]) throw new AppError('Invalid date filter',400);
    query[config.time] = { ...query[config.time], [operator]: date };
  }
  if (params.from && params.to && params.from>params.to) throw new AppError('From date must be before to date',400);
  if (params.q) {
    if (typeof params.q !== 'string' || params.q.length>100) throw new AppError('Search must be at most 100 characters',400);
    const escaped = params.q.trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    if (escaped) {
      query.$or = config.fields.map(field => ({ [field]: { $regex: escaped, $options: 'i' } }));
      if (mongoose.isValidObjectId(params.q)) {
        query.$or.push({ _id: params.q });
        if(kind !== 'users') query.$or.push({ userId: params.q });
      }
    }
  }
  return { config, query, page, limit };
}
async function attachUsers(items) {
  const ids = [...new Set(items.map(row => String(row.userId || '')).filter(Boolean))];
  if (!ids.length) return items;
  const rows = env.useMongoDB
    ? await users.User.find({ _id: { $in: ids } }).select('name email publicId').lean()
    : (await users.listUsers()).filter(user => ids.includes(user.id));
  const byId = new Map(rows.map(user => [String(user._id || user.id), { id: String(user._id || user.id), name: user.name, email: user.email, publicId: user.publicId || null }]));
  return items.map(row => ({ ...row, user: byId.get(String(row.userId)) || null }));
}
async function list(kind, params = {}) {
  const {config,query,page,limit} = buildQuery(kind,params);
  let items,total;
  if (env.useMongoDB) {
    [items,total] = await Promise.all([
      config.model.find(query).select(config.projection || '').sort({[config.time]:-1,_id:-1}).skip((page-1)*limit).limit(limit).lean().maxTimeMS(10000),
      config.model.countDocuments(query).maxTimeMS(10000)
    ]);
    items=items.map(config.convert);
  } else {
    const q=String(params.q || '').trim().toLowerCase();
    const rows=(await config.read()).filter(row => (!params.userId || String(row.userId)===params.userId) && (!params.status || row.status===params.status) && (!params.metricType || row.metricType===params.metricType) && (kind !== 'devices' || ((!params.platform || row.platform===params.platform) && (!params.model || row.model===params.model))) &&
      (!q || [...config.fields,'id','userId'].some(f=>String(row[f] || '').toLowerCase().includes(q))) &&
      (!query[config.time]?.$gte || new Date(row[config.time])>=query[config.time].$gte) && (!query[config.time]?.$lte || new Date(row[config.time])<=query[config.time].$lte))
      .sort((a,b)=>new Date(b[config.time])-new Date(a[config.time]) || String(b.id).localeCompare(String(a.id)));
    total=rows.length;items=rows.slice((page-1)*limit,page*limit);
  }
  if (kind === 'users') items = items.map(user => ({...user,isAdmin:env.adminEmails.includes(String(user.email||'').toLowerCase()) || ['ADMIN','SUB_ADMIN'].includes(user.role)}));
  else items = await attachUsers(items);
  let deviceFilters;
  if (kind === 'devices') {
    // Read distinct registered combinations across all pages, independent of search.
    const scope = query.userId ? { userId: query.userId } : {};
    const combinations = env.useMongoDB
      ? await devices.Device.aggregate([{ $match: scope }, { $group: { _id: { platform: '$platform', model: '$model' } } }]).option({ maxTimeMS: 10000 })
      : (await devices.listAdmin()).filter(row => !params.userId || String(row.userId) === params.userId).map(row => ({ _id: { platform: row.platform, model: row.model } }));
    const unique = new Map();
    for (const { _id: { platform, model } } of combinations) {
      if (typeof model === 'string' && model.trim()) unique.set(JSON.stringify([platform,model]), { platform, model });
    }
    deviceFilters = [...unique.values()].sort((a,b) => a.model.localeCompare(b.model));
  }
  return {items,total,page,limit,totalPages:Math.ceil(total/limit), ...(deviceFilters ? { deviceFilters } : {})};
}
async function overview() {
  if(env.useMongoDB) {
    const today=new Date();today.setUTCHours(0,0,0,0);
    const [userCount,recordCount,deviceCount,syncedToday,recent]=await Promise.all([
      users.User.countDocuments({}),health.HealthRecord.countDocuments({}),devices.Device.countDocuments({status:'ACTIVE'}),
      health.HealthRecord.countDocuments({createdAt:{$gte:today}}),
      health.HealthRecord.find().sort({recordedAt:-1,_id:-1}).limit(8).lean()
    ]);
    return {users:userCount,records:recordCount,devices:deviceCount,syncedToday,storage:'mongodb',recentRecords:await attachUsers(recent.map(configs.records.convert))};
  }
  const [u,h,d]=await Promise.all([users.listUsers(),health.listAdmin(),devices.listAdmin()]);
  return {users:u.length,records:h.length,devices:d.filter(x=>x.status==='ACTIVE').length,syncedToday:h.filter(x=>new Date(x.createdAt).toISOString().slice(0,10)===new Date().toISOString().slice(0,10)).length,storage:'temporary',recentRecords:await attachUsers(h.sort((a,b)=>new Date(b.recordedAt)-new Date(a.recordedAt)).slice(0,8))};
}
module.exports={list,overview,buildQuery};
