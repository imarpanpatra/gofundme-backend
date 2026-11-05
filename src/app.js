import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { connectDb } from './db.js';
import authRoutes from './routes/auth.js';
import pageRoutes from './routes/pages.js';
import paymentRoutes, { webhookHandler } from './routes/payments.js';
import dashboardRoutes from './routes/dashboard.js';
import contactRoutes from './routes/contact.js';

const app = express();

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(
  cors({
    origin: (origin, cb) => cb(null, !origin || config.clientUrls.includes(origin.replace(/\/$/, ''))),
  })
);

app.get('/', (req, res) => res.json({ ok: true, service: 'gofundme-api' }));
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use(async (req, res, next) => {
  try {
    await connectDb();
    next();
  } catch (err) {
    console.error('MongoDB connection failed:', err.message);
    res.status(503).json({ error: 'Database unavailable, please try again shortly' });
  }
});

app.post('/api/payments/webhook', ...webhookHandler);

app.use(express.json({ limit: '200kb' }));

app.use('/api/auth', authRoutes);
app.use('/api/pages', pageRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/contact', contactRoutes);
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Image is too large (max 4MB)' });
  console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
});

export default app;
