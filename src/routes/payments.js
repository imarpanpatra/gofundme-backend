import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { User } from '../models/User.js';
import { Support } from '../models/Support.js';
import multer from 'multer';
import {
  verifyOrderSignature,
  verifySubscriptionSignature,
  verifyWebhookSignature,
} from '../lib/razorpay.js';
import { requireAccount } from '../middleware/auth.js';
import { startCheckout, parseAmount } from '../lib/checkout.js';
import { onPaid, onSubscriptionStatus } from '../lib/fulfillment.js';
import { uploadFile, baseType, isCatboxUrl } from '../lib/catbox.js';

const router = Router();

const orderLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

const videoLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false });

const VIDEO_TYPES = ['video/webm', 'video/mp4', 'video/quicktime'];
const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, VIDEO_TYPES.includes(baseType(file.mimetype))),
});

router.post('/video', videoLimiter, requireAccount, videoUpload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a WEBM, MP4 or MOV video up to 4MB' });
  const url = await uploadFile({ buffer: req.file.buffer, contentType: req.file.mimetype, prefix: 'video' });
  res.json({ url });
});

router.post('/order', orderLimiter, requireAccount, async (req, res) => {
  const { slug, amount, name, message, isPrivate, monthly, videoUrl } = req.body || {};
  const creator = await User.findOne({ slug: String(slug || '').toLowerCase() });
  if (!creator) return res.status(404).json({ error: 'Page not found' });

  const isMonthly = Boolean(monthly) && creator.recurringEnabled;
  const paise = parseAmount(amount, { wholeOnly: isMonthly });
  if (paise === null) {
    return res.status(400).json({
      error: `Enter an amount between ₹${config.minAmount} and ₹${config.maxAmount.toLocaleString('en-IN')}`,
    });
  }
  if (videoUrl && !isCatboxUrl(videoUrl)) return res.status(400).json({ error: 'Invalid video message' });

  const support = await Support.create({
    creator: creator._id,
    account: req.actor.id,
    accountKind: req.actor.kind,
    type: 'tip',
    name: String(name || '').trim().slice(0, 60),
    message: String(message || '').trim().slice(0, 1000),
    isPrivate: Boolean(isPrivate),
    videoUrl: videoUrl || '',
    amount: paise,
    currency: config.currency,
    monthly: isMonthly,
  });

  const result = await startCheckout({ support, creator, actor: req.actor });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.json(result.body);
});

router.post('/verify', async (req, res) => {
  const {
    razorpay_order_id: orderId,
    razorpay_subscription_id: subscriptionId,
    razorpay_payment_id: paymentId,
    razorpay_signature: signature,
  } = req.body || {};
  if (!paymentId || !signature || (!orderId && !subscriptionId)) {
    return res.status(400).json({ error: 'Missing payment details' });
  }

  const support = orderId
    ? await Support.findOne({ razorpayOrderId: orderId })
    : await Support.findOne({ razorpaySubscriptionId: subscriptionId }).sort({ createdAt: 1 });
  if (!support) return res.status(404).json({ error: 'Payment not found' });

  const valid = orderId
    ? verifyOrderSignature(orderId, paymentId, signature)
    : verifySubscriptionSignature(subscriptionId, paymentId, signature);
  if (!valid) return res.status(400).json({ error: 'Payment verification failed' });

  if (support.status !== 'paid') {
    support.status = 'paid';
    support.razorpayPaymentId = paymentId;
    support.paidAt = new Date();
    if (subscriptionId) support.subscriptionStatus = 'active';
    await support.save();
    await onPaid(support);
  }
  res.json({ support: support.toPublic() });
});

async function markOrderPaid(payment) {
  const support = await Support.findOne({ razorpayOrderId: payment.order_id });
  if (!support || support.status === 'paid') return;
  support.status = 'paid';
  support.razorpayPaymentId = payment.id;
  support.paidAt = new Date((payment.created_at || Date.now() / 1000) * 1000);
  await support.save();
  await onPaid(support);
}

async function markOrderFailed(payment) {
  await Support.updateOne({ razorpayOrderId: payment.order_id, status: 'created' }, { status: 'failed' });
}

async function recordSubscriptionCharge(subscription, payment) {
  const head = await Support.findOne({ razorpaySubscriptionId: subscription.id }).sort({ createdAt: 1 });
  if (!head) return;
  if (await Support.exists({ razorpayPaymentId: payment.id })) return;

  const paidAt = new Date((payment.created_at || Date.now() / 1000) * 1000);
  if (head.status !== 'paid') {
    head.status = 'paid';
    head.razorpayPaymentId = payment.id;
    head.paidAt = paidAt;
    head.subscriptionStatus = subscription.status;
    await head.save();
    await onPaid(head);
    return;
  }
  const charge = await Support.create({
    creator: head.creator,
    account: head.account,
    accountKind: head.accountKind,
    type: head.type,
    tier: head.tier,
    tierName: head.tierName,
    name: head.name,
    message: '',
    isPrivate: head.isPrivate,
    amount: payment.amount,
    currency: payment.currency,
    monthly: true,
    status: 'paid',
    razorpaySubscriptionId: subscription.id,
    razorpayPaymentId: payment.id,
    subscriptionStatus: subscription.status,
    paidAt,
  });
  await onPaid(charge, { firstCharge: false });
}

export const webhookHandler = [
  express.raw({ type: '*/*', limit: '1mb' }),
  async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : typeof req.body === 'string' ? req.body : '';
    if (!raw) {
      console.error('Webhook: raw request body unavailable, cannot verify signature');
      return res.status(400).json({ error: 'Empty payload' });
    }
    if (!verifyWebhookSignature(raw, req.headers['x-razorpay-signature'])) {
      return res.status(400).json({ error: 'Invalid signature' });
    }
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const payment = event.payload?.payment?.entity;
    const subscription = event.payload?.subscription?.entity;
    try {
      switch (event.event) {
        case 'payment.captured':
        case 'order.paid':
          if (payment?.order_id) await markOrderPaid(payment);
          break;
        case 'payment.failed':
          if (payment?.order_id) await markOrderFailed(payment);
          break;
        case 'subscription.charged':
          if (subscription && payment) await recordSubscriptionCharge(subscription, payment);
          break;
        case 'subscription.cancelled':
        case 'subscription.halted':
        case 'subscription.completed':
        case 'subscription.paused':
        case 'subscription.resumed':
        case 'subscription.activated':
          if (subscription) {
            await Support.updateMany({ razorpaySubscriptionId: subscription.id }, { subscriptionStatus: subscription.status });
            await onSubscriptionStatus(subscription.id, subscription.status);
          }
          break;
        default:
          break;
      }
      res.json({ ok: true });
    } catch (err) {
      console.error('Webhook handling failed:', err);
      res.status(500).json({ error: 'Webhook handling failed' });
    }
  },
];

export default router;
