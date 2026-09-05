import pino from 'pino';
import { env } from './env.js';

const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : process.env.LOG_LEVEL || 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.body.password',
      'req.body.currentPassword',
      'req.body.newPassword',
      '*.password',
      '*.token',
      '*.refreshToken',
      '*.otp'
    ],
    censor: '[REDACTED]'
  }
});

export default logger;

