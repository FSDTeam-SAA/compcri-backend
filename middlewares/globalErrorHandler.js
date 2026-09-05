import { StatusCodes } from 'http-status-codes';

const globalErrorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || StatusCodes.INTERNAL_SERVER_ERROR;
  let message = err.message || 'Something went wrong';

  if (err.name === 'MulterError') {
    statusCode = StatusCodes.BAD_REQUEST;
    message = err.message;
  }

  if (err.http_code) {
    statusCode = err.http_code;
  }

  let code = err.code || 'INTERNAL_ERROR';
  let details = err.details;

  if (err.name === 'CastError') {
    statusCode = StatusCodes.BAD_REQUEST;
    message = 'Invalid resource identifier';
    code = 'INVALID_ID';
  }

  if (err.name === 'VersionError') {
    statusCode = StatusCodes.CONFLICT;
    message = 'Resource has changed; refresh and retry';
    code = 'VERSION_CONFLICT';
  }

  if (err.code === 11000) {
    statusCode = StatusCodes.CONFLICT;
    message = 'A resource with that value already exists';
    code = 'DUPLICATE_RESOURCE';
    details = err.keyValue;
  }

  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    statusCode = StatusCodes.UNAUTHORIZED;
    message = 'Authentication token is invalid or expired';
    code = 'INVALID_TOKEN';
  }

  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      ...(details && { details }),
      requestId: req.id,
      ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
    }
  });
};

export default globalErrorHandler;
