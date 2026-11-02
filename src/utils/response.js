const successResponse = (res, statusCode, message, data = null) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data
  });
};

const errorResponse = (res, statusCode, message, details = null) => {
  return res.status(statusCode).json({
    success: false,
    error: {
      code: details && details.code ? details.code : 'API_ERROR',
      message,
      details
    }
  });
};

module.exports = {
  successResponse,
  errorResponse
};
