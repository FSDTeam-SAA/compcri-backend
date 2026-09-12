import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import logger from './config/logger.js';
import { openapi } from './docs/openapi.js';
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import mediaRoutes from './routes/media.routes.js';
import legalRoutes, { supportRouter } from './routes/legal.routes.js';
import eventRoutes from './routes/event.routes.js';
import delegationRoutes from './routes/delegation.routes.js';
import networkRoutes from './routes/network.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import noteRoutes from './routes/note.routes.js';
import subscriptionRoutes from './routes/subscription.routes.js';
import aiRoutes from './routes/ai.routes.js';
import adminRoutes from './routes/admin.routes.js';
import notFound from './middlewares/notFound.js';
import globalErrorHandler from './middlewares/globalErrorHandler.js';
import { requestContext } from './middlewares/requestContext.js';
import { apiLimiter } from './middlewares/rateLimit.js';

const app = express();
if (env.TRUST_PROXY) app.set('trust proxy', 1);

app.use(requestContext);
app.use(pinoHttp({ logger, customProps: (req) => ({ requestId: req.id }) }));
app.use(helmet({ contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || env.CORS_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    data: { name: env.APP_NAME, version: '1.0.0', status: 'running' }
  });
});

app.get('/health/live', (req, res) => res.json({ success: true, data: { status: 'alive' } }));
app.get('/health/ready', (req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({ success: ready, ...(ready ? { data: { status: 'ready' } } : { error: { code: 'NOT_READY', message: 'Database is not ready', requestId: req.id } }) });
});
app.get('/openapi.json', (req, res) => res.json(openapi));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));

app.use('/api/v1', apiLimiter);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/media', mediaRoutes);
app.use('/api/v1/legal', legalRoutes);
app.use('/api/v1/support-requests', supportRouter);
app.use('/api/v1', eventRoutes);
app.use('/api/v1/delegations', delegationRoutes);
app.use('/api/v1', networkRoutes);
app.use('/api/v1', notificationRoutes);
app.use('/api/v1', noteRoutes);
app.use('/api/v1', subscriptionRoutes);
app.use('/api/v1/ai', aiRoutes);
app.use('/api/v1/admin', adminRoutes);

app.use(notFound);
app.use(globalErrorHandler);

export default app;
