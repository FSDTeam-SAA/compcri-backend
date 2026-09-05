import { StatusCodes } from 'http-status-codes';
import ApiError from '../utils/ApiError.js';

export const validate = (schemas) => (req, res, next) => {
  for (const key of ['params', 'query', 'body']) {
    if (!schemas[key]) continue;
    const result = schemas[key].safeParse(req[key]);
    if (!result.success) {
      return next(new ApiError(
        StatusCodes.UNPROCESSABLE_ENTITY,
        'Validation failed',
        'VALIDATION_ERROR',
        result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
      ));
    }
    if (key === 'query') {
      // Express 5 exposes req.query through a getter, so install the validated
      // value on this request instead of assigning to the inherited accessor.
      Object.defineProperty(req, 'query', { value: result.data, writable: true, configurable: true, enumerable: true });
    } else {
      req[key] = result.data;
    }
  }
  next();
};
