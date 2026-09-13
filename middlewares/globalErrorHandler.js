import { StatusCodes } from 'http-status-codes';
import { requestLocale, translate } from '../utils/i18n.js';

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

  // People read `message`; `code` stays stable for clients to branch on.
  const locale = requestLocale(req);
  if (Array.isArray(details)) {
    details = details.map((item) => (item?.message ? { ...item, message: translate(locale, item.message) } : item));
  }

  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message: translate(locale, message),
      ...(details && { details }),
      requestId: req.id,
      ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
    }
  });
};

export default globalErrorHandler;
