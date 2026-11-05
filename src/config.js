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
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  },
  catboxUserhash: process.env.CATBOX_USERHASH || '',
  defaultCreator: process.env.DEFAULT_CREATOR || 'arpanpatra',
  currency: 'INR',
  minAmount: 1,
  maxAmount: 500000,
};
