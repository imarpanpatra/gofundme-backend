import 'dotenv/config';

const required = ['MONGO_URI', 'JWT_SECRET', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'];
export const missingEnv = required.filter((k) => !process.env[k]?.trim());

export const config = {
  port: Number(process.env.PORT) || 5050,
  mongoUri: process.env.MONGO_URI,
  clientUrls: (process.env.CLIENT_URL || 'http://localhost:5173')
    .split(',')
    .map((u) => u.trim().replace(/\/$/, ''))
    .filter(Boolean),
  jwtSecret: process.env.JWT_SECRET,
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID?.trim(),
    keySecret: process.env.RAZORPAY_KEY_SECRET?.trim(),
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET?.trim() || '',
  },
  googleClientId: (process.env.GOOGLE_CLIENT_ID || '1934199762-jh82prahuornnf1m98tvr2jgt77fm3uk.apps.googleusercontent.com').trim(),
  catboxUserhash: process.env.CATBOX_USERHASH || '',
  defaultCreator: process.env.DEFAULT_CREATOR || 'arpanpatra',
  currency: 'INR',
  minAmount: 11,
  maxAmount: 500000,
};
