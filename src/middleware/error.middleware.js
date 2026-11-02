const { errorResponse } = require('../utils/response');

class AppError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
  }
}

const notFoundHandler = (req, res, next) => {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404));
};

const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.isOperational ? err.message : 'Internal server error';
  const details = err.details || null;

  if (!err.isOperational) {
    console.error(err);
  }

  return errorResponse(res, statusCode, message, details);
};

module.exports = {
  AppError,
  notFoundHandler,
  errorHandler
};
