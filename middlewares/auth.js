import { StatusCodes } from 'http-status-codes';
import User from '../models/User.js';
import ApiError from '../utils/ApiError.js';
import { verifyAccessToken } from '../services/token.service.js';

export const authenticate = async (req, res, next) => {
  try {
    const [scheme, token] = (req.headers.authorization || '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new ApiError(StatusCodes.UNAUTHORIZED, 'Authentication required', 'AUTH_REQUIRED');
    const payload = verifyAccessToken(token);
    if (payload.type !== 'access') throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid token type', 'INVALID_TOKEN');
    const user = await User.findById(payload.sub);
    if (!user || user.status !== 'ACTIVE') throw new ApiError(StatusCodes.FORBIDDEN, 'Account is unavailable', 'ACCOUNT_UNAVAILABLE');
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

export const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) return next(new ApiError(StatusCodes.FORBIDDEN, 'Insufficient permission', 'ROLE_FORBIDDEN'));
  next();
};

