const router=require('express').Router();
const {authenticate}=require('../middleware/auth.middleware');
const daily=require('../services/daily-settlement.service');
const {successResponse}=require('../utils/response');
const query=require('../services/admin-query.service');
router.use(authenticate);
router.get('/today',async(req,res,next)=>{try{successResponse(res,200,'Daily activity and pending coins',await daily.progress(req.user.id,req.query.day));}catch(error){next(error);}});
router.get('/history',async(req,res,next)=>{try{const {page,limit}=query.buildQuery('users',req.query);successResponse(res,200,'Daily coin history',await daily.history(req.user.id,page,limit,req.query));}catch(error){next(error);}});
router.get('/records',async(req,res,next)=>{try{successResponse(res,200,'Paginated activity records',await query.list('records',{...req.query,userId:req.user.id}));}catch(error){next(error);}});
router.get('/transactions',async(req,res,next)=>{try{
 const {page,limit}=query.buildQuery('users',req.query);const env=require('../config/env');const wallet=require('../models/wallet.model');
 if(env.useMongoDB){const [rows,total]=await Promise.all([wallet.WalletTransaction.find({userId:req.user.id}).sort({createdAt:-1,_id:-1}).skip((page-1)*limit).limit(limit).lean(),wallet.WalletTransaction.countDocuments({userId:req.user.id})]);return successResponse(res,200,'Coin ledger',{items:rows.map(wallet.toTransaction),total,page,limit});}
 const rows=await wallet.getTransactionsByUserId(req.user.id);successResponse(res,200,'Coin ledger',{items:rows.slice((page-1)*limit,page*limit),total:rows.length,page,limit});
 }catch(error){next(error);}});
module.exports=router;
