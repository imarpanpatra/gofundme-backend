import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config, missingEnv } from './config.js';
import { connectDb } from './db.js';
import authRoutes from './routes/auth.js';
import pageRoutes from './routes/pages.js';
import paymentRoutes, { webhookHandler } from './routes/payments.js';
import studioRoutes from './routes/studio.js';
import postRoutes from './routes/posts.js';
import membershipRoutes from './routes/memberships.js';
import shopRoutes from './routes/shop.js';
import accountRoutes from './routes/account.js';
import contactRoutes from './routes/contact.js';
import profileRoutes from './routes/profiles.js';
import seoRoutes from './routes/seo.js';

const app = express();

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(
  cors({
    origin: (origin, cb) => cb(null, !origin || config.clientUrls.includes(origin.replace(/\/$/, ''))),
  })
);

app.get('/', (req, res) => res.json({ ok: true, service: 'gofundme-api' }));
app.get('/api/health', (req, res) => {
  if (missingEnv.length) return res.status(500).json({ ok: false, missingEnv });
  res.json({ ok: true });
});

app.use((req, res, next) => {
  if (!missingEnv.length) return next();
  console.error(`Missing env vars: ${missingEnv.join(', ')}`);
  res.status(500).json({ error: `Server is missing configuration: ${missingEnv.join(', ')}` });
});

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

app.use(express.json({ limit: '600kb' }));

app.use('/api/auth', authRoutes);
app.use('/api/pages', pageRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/studio', studioRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/memberships', membershipRoutes);
app.use('/api/shop', shopRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/seo', seoRoutes);
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File is too large (max 4MB)' });
  console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
});

export default app;
