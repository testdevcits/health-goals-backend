const walletService = require('../services/wallet.service');
const { successResponse } = require('../utils/response');

const getWallet = async (req, res, next) => {
  try {
    const data = await walletService.getWallet(req.user.id);
    return successResponse(res, 200, 'Wallet fetched successfully', data);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getWallet
};
