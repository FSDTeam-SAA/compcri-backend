import { StatusCodes } from 'http-status-codes';
import { requestLocale, translate } from '../utils/i18n.js';

const notFound = (req, res) => {
  res.status(StatusCodes.NOT_FOUND).json({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: translate(requestLocale(req), 'Route not found: {path}', { path: req.originalUrl }),
      requestId: req.id
    }
  });
};

export default notFound;
