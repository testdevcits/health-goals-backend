const mongoose = require('mongoose');
const env = require('../config/env');
const users = require('../models/user.model');
const health = require('../models/health.model');
const devices = require('../models/device.model');
const { AppError } = require('../middleware/error.middleware');
const configs = {
  users: { model: users.User, read: users.listUsers, time: 'createdAt', fields: ['name','email','publicId','gender'], projection: '-passwordHash -refreshTokenHash -profileAnswers', convert: users.toPublicUser },
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
  if (kind === 'records' && params.source) {
    if (typeof params.source !== 'string' || params.source.length > 80) throw new AppError('Invalid record source',400);
    query.source = params.source;
  }
  if (kind === 'users') {
    if (params.gender) {
      if (typeof params.gender !== 'string' || params.gender.length > 100) throw new AppError('Invalid gender filter',400);
      query.gender = params.gender;
    }
    const range = (key,min,max) => {
      if (params[key] === undefined || params[key] === '') return undefined;
      const value = Number(params[key]);
      if (!Number.isFinite(value) || value < min || value > max) throw new AppError(`Invalid ${key} filter`,400);
      return value;
    };
    const minAge=range('minAge',0,120),maxAge=range('maxAge',0,120);
    const minWeightKg=range('minWeightKg',20,500),maxWeightKg=range('maxWeightKg',20,500);
    const minHeightCm=range('minHeightCm',50,300),maxHeightCm=range('maxHeightCm',50,300);
    if(minAge!==undefined&&maxAge!==undefined&&minAge>maxAge)throw new AppError('Minimum age cannot exceed maximum age',400);
    if(minWeightKg!==undefined&&maxWeightKg!==undefined&&minWeightKg>maxWeightKg)throw new AppError('Minimum weight cannot exceed maximum weight',400);
    if(minHeightCm!==undefined&&maxHeightCm!==undefined&&minHeightCm>maxHeightCm)throw new AppError('Minimum height cannot exceed maximum height',400);
    for(const [field,lower,upper] of [['weightKg',minWeightKg,maxWeightKg],['heightCm',minHeightCm,maxHeightCm]]) if(lower!==undefined||upper!==undefined) query[field]={...(lower!==undefined?{$gte:lower}:{}),...(upper!==undefined?{$lte:upper}:{})};
    if(minAge!==undefined||maxAge!==undefined){
      const dob={$dateFromString:{dateString:'$birthDate',format:'%d/%m/%Y',onError:null,onNull:null}};
      const age={$subtract:[{$subtract:[{$year:{date:'$$NOW',timezone:'Asia/Kolkata'}},{$year:{date:'$$dob',timezone:'Asia/Kolkata'}}]},{$cond:[{$lt:[{$dateToString:{date:'$$NOW',format:'%m%d',timezone:'Asia/Kolkata'}},{$dateToString:{date:'$$dob',format:'%m%d',timezone:'Asia/Kolkata'}}]},1,0]}]};
      query.$expr={$let:{vars:{dob},in:{$and:[{$ne:['$$dob',null]},...(minAge!==undefined?[{$gte:[age,minAge]}]:[]),...(maxAge!==undefined?[{$lte:[age,maxAge]}]:[])]}}};
    }
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
    // Health records and their date picker use Asia/Kolkata calendar days.
    if (kind === 'records') date.setTime(+date - 330 * 60 * 1000);
    query[config.time] = { ...query[config.time], [operator]: date };
  }
  if (params.from && params.to && params.from>params.to) throw new AppError('From date must be before to date',400);
  if (params.q) {
    if (typeof params.q !== 'string' || params.q.length>100) throw new AppError('Search must be at most 100 characters',400);
    const escaped = params.q.trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    if (escaped) {
      query.$or = config.fields.map(field => ({ [field]: { $regex: escaped, $options: 'i' } }));
      if(kind==='records'){
        const normalizedMetric=escaped.replace(/\s+/g,'_');
        if(normalizedMetric!==escaped)query.$or.push({metricType:{$regex:normalizedMetric,$options:'i'}});
      }
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
  if(kind==='records'&&params.q&&env.useMongoDB){
    const escaped=String(params.q).trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    if(escaped){const matchingUsers=await users.User.find({$or:['name','email','publicId'].map(field=>({[field]:{$regex:escaped,$options:'i'}}))}).select('_id').limit(500).lean();if(matchingUsers.length)query.$or.push({userId:{$in:matchingUsers.map(user=>user._id)}});}
  }
  const allowedSorts=kind==='records'?['recordedAt','metricType','value','source']:kind==='users'?['name','email','createdAt']:['model','platform','createdAt'];
  const sortBy=params.sortBy||config.time;
  if(!allowedSorts.includes(sortBy))throw new AppError('Invalid sort field',400);
  const sortOrder=params.sortOrder||'desc';
  if(!['asc','desc'].includes(sortOrder))throw new AppError('Invalid sort order',400);
  const direction=sortOrder==='asc'?1:-1;
  let items,total;
  if (env.useMongoDB) {
    [items,total] = await Promise.all([
      config.model.find(query).select(config.projection || '').sort({[sortBy]:direction,_id:direction}).skip((page-1)*limit).limit(limit).lean().maxTimeMS(10000),
      config.model.countDocuments(query).maxTimeMS(10000)
    ]);
    items=items.map(config.convert);
  } else {
    const q=String(params.q || '').trim().toLowerCase();
    const allUsers=kind==='records'&&q?await users.listUsers():[];
    const userById=new Map(allUsers.map(user=>[String(user.id),user]));
    const rows=(await config.read()).filter(row => (!params.userId || String(row.userId)===params.userId) && (!params.status || row.status===params.status) && (!params.metricType || row.metricType===params.metricType) && (kind!=='records'||!params.source||row.source===params.source) && (kind !== 'devices' || ((!params.platform || row.platform===params.platform) && (!params.model || row.model===params.model))) &&
      (kind !== 'users' || (!params.gender || row.gender===params.gender) && inAgeRange(row.birthDate||row.birth_date,params.minAge,params.maxAge) && inNumericRange(row.weightKg??row.weight_kg,params.minWeightKg,params.maxWeightKg) && inNumericRange(row.heightCm??row.height_cm,params.minHeightCm,params.maxHeightCm)) &&
      (!q || [...config.fields,'id','userId'].some(f=>String(row[f] || '').toLowerCase().includes(q)) || (kind==='records'&&(String(row.metricType||'').replaceAll('_',' ').toLowerCase().includes(q)||[userById.get(String(row.userId))?.name,userById.get(String(row.userId))?.email,userById.get(String(row.userId))?.publicId].some(value=>String(value||'').toLowerCase().includes(q))))) &&
      (!query[config.time]?.$gte || new Date(row[config.time])>=query[config.time].$gte) && (!query[config.time]?.$lte || new Date(row[config.time])<=query[config.time].$lte))
      .sort((a,b)=>{const av=a[sortBy],bv=b[sortBy];const cmp=sortBy==='recordedAt'||sortBy==='createdAt'?new Date(av)-new Date(bv):typeof av==='number'||typeof bv==='number'?Number(av||0)-Number(bv||0):String(av||'').localeCompare(String(bv||''),undefined,{numeric:true,sensitivity:'base'});return cmp*direction||String(a.id).localeCompare(String(b.id))*direction;});
    total=rows.length;items=rows.slice((page-1)*limit,page*limit);
  }
  if (kind === 'users') items = items.map(user => {const {profileAnswers,birthDate,birth_date,...safeUser}=user;return {...safeUser,age:ageFromBirthDate(birthDate||birth_date),isAdmin:env.adminEmails.includes(String(user.email||'').toLowerCase()) || ['ADMIN','SUB_ADMIN'].includes(user.role)};});
  else items = await attachUsers(items);
  let deviceFilters, userFilters, sourceFilters;
  if (kind === 'users') {
    const genders = env.useMongoDB ? await users.User.distinct('gender') : (await config.read()).map(user => user.gender);
    userFilters = { genders: [...new Set(genders.filter(value => typeof value === 'string' && value))].sort((a,b) => a.localeCompare(b)) };
  }
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
  if (kind === 'records') {
    const sources=env.useMongoDB?await health.HealthRecord.distinct('source'):((await health.listAdmin()).map(row=>row.source));
    sourceFilters=[...new Set(sources.filter(value=>typeof value==='string'&&value))].sort((a,b)=>a.localeCompare(b));
  }
  return {items,total,page,limit,totalPages:Math.ceil(total/limit), ...(deviceFilters ? { deviceFilters } : {}), ...(userFilters ? { userFilters } : {}), ...(sourceFilters ? { sourceFilters } : {})};
}
function inNumericRange(value,min,max){if((min===undefined||min==='')&&(max===undefined||max===''))return true;if(value===null||value===undefined||value==='')return false;const number=Number(value);return (min===undefined||min===''||number>=Number(min))&&(max===undefined||max===''||number<=Number(max));}
function calculateAge(value){if(!value)return null;const match=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);if(!match)return null;const [,d,m,y]=match,parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),today=Object.fromEntries(parts.map(part=>[part.type,Number(part.value)])),birth=new Date(Number(y),Number(m)-1,Number(d));if(birth.getFullYear()!==Number(y)||birth.getMonth()!==Number(m)-1||birth.getDate()!==Number(d))return null;let age=today.year-birth.getFullYear();if(today.month<Number(m)||(today.month===Number(m)&&today.day<Number(d)))age--;return age<0||age>120?null:age;}
function inAgeRange(value,min,max){if((min===undefined||min==='')&&(max===undefined||max===''))return true;const age=calculateAge(value);return age!==null&&(min===undefined||min===''||age>=Number(min))&&(max===undefined||max===''||age<=Number(max));}
function ageFromBirthDate(value){return calculateAge(value);}
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
