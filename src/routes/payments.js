import express, { Router } from 'express';
import { limiter } from '../lib/limiter.js';
import { config } from '../config.js';
import { User } from '../models/User.js';
import { Support } from '../models/Support.js';
import { Moment } from '../models/Moment.js';
import { momentStats } from '../lib/moments.js';
import mongoose from 'mongoose';
import multer from 'multer';
import {
  getRazorpay,
  verifyOrderSignature,
  verifySubscriptionSignature,
  verifyWebhookSignature,
} from '../lib/razorpay.js';
import { requireAccount } from '../middleware/auth.js';
import { startCheckout, parseAmount } from '../lib/checkout.js';
import { onPaid, onRefunded, onSubscriptionStatus } from '../lib/fulfillment.js';
import { uploadFile, baseType, isCatboxUrl } from '../lib/catbox.js';

const router = Router();

const orderLimiter = limiter('orderLimiter', 10 * 60 * 1000, 30);

const videoLimiter = limiter('videoLimiter', 60 * 60 * 1000, 15);

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
  const { slug, amount, name, message, isPrivate, monthly, videoUrl, momentId } = req.body || {};
  const creator = await User.findBySlug(slug);
  if (!creator) return res.status(404).json({ error: 'Page not found' });

  let moment = null;
  let remaining = 0;
  if (momentId) {
    if (!mongoose.isValidObjectId(momentId)) return res.status(404).json({ error: 'This moment no longer exists' });
    moment = await Moment.findOne({ _id: momentId, creator: creator._id, active: true });
    if (!moment || moment.cost <= 0) return res.status(404).json({ error: 'This moment no longer exists' });
    const stats = (await momentStats(creator._id, [moment._id])).get(String(moment._id));
    remaining = Math.ceil(moment.cost - (stats?.raised || 0));
    if (remaining <= 0) return res.status(409).json({ error: 'This moment is already fully sponsored. Thank you!' });
  }

  const isMonthly = Boolean(monthly) && creator.recurringEnabled && !moment;
  const exactRest = moment && remaining < config.minAmount && Number(amount) === remaining;
  const paise = exactRest ? remaining * 100 : parseAmount(amount, { wholeOnly: isMonthly });
  if (paise === null) {
    return res.status(400).json({
      error: moment && remaining < config.minAmount
        ? `Only ₹${remaining} is left on this moment`
        : `Enter an amount between ₹${config.minAmount} and ₹${config.maxAmount.toLocaleString('en-IN')}`,
    });
  }
  if (moment && paise > remaining * 100) {
    return res.status(400).json({ error: `Only ₹${remaining.toLocaleString('en-IN')} is left on this moment` });
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
    ...(moment ? { moment: moment._id, momentTitle: moment.title } : {}),
  });

  const result = await startCheckout({ support, creator, actor: req.actor, extraNotes: moment ? { moment: moment.title.slice(0, 200) } : {} });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.json(result.body);
});

router.get('/status/:supportId', requireAccount, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.supportId)) return res.status(404).json({ error: 'Payment not found' });
  const support = await Support.findOne({ _id: req.params.supportId, account: req.actor.id });
  if (!support) return res.status(404).json({ error: 'Payment not found' });
  res.json({ status: support.status, support: support.status === 'paid' ? support.toPublic() : null });
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

  let support = orderId
    ? await Support.findOne({ razorpayOrderId: String(orderId) })
    : await Support.findOne({ razorpaySubscriptionId: String(subscriptionId) }).sort({ createdAt: 1 });
  if (!support) return res.status(404).json({ error: 'Payment not found' });

  const valid = orderId
    ? verifyOrderSignature(orderId, paymentId, signature)
    : verifySubscriptionSignature(subscriptionId, paymentId, signature);
  if (!valid) return res.status(400).json({ error: 'Payment verification failed' });

  if (support.status !== 'paid') {
    const claimed = await claimPaid(support._id, {
      razorpayPaymentId: String(paymentId),
      paidAt: new Date(),
      ...(subscriptionId ? { subscriptionStatus: 'active' } : {}),
    });
    if (claimed) await onPaid(claimed);
    support = claimed || (await Support.findById(support._id));
  }
  res.json({ support: support.toPublic() });
});

async function claimPaid(supportId, fields) {
  try {
    return await Support.findOneAndUpdate({ _id: supportId, status: { $ne: 'paid' } }, { $set: { status: 'paid', ...fields } }, { new: true });
  } catch (err) {
    if (err?.code === 11000) return null;
    throw err;
  }
}

async function markOrderPaid(payment) {
  const support = await Support.findOne({ razorpayOrderId: payment.order_id }, { _id: 1, status: 1 });
  if (!support || support.status === 'paid') return;
  const claimed = await claimPaid(support._id, {
    razorpayPaymentId: payment.id,
    paidAt: new Date((payment.created_at || Date.now() / 1000) * 1000),
  });
  if (claimed) await onPaid(claimed);
}

async function recordRefund(paymentId, refundedPaise) {
  const refunded = Math.round(Number(refundedPaise) || 0);
  if (!paymentId || refunded <= 0) return;
  const support = await Support.findOne({ razorpayPaymentId: paymentId, status: 'paid' });
  if (!support) return;
  const original = support.originalAmount ?? support.amount;
  if (refunded >= original) {
    const done = await Support.findOneAndUpdate(
      { _id: support._id, status: 'paid' },
      { $set: { status: 'refunded', originalAmount: original, amountRefunded: original, amount: 0 } },
      { new: true }
    );
    if (done) await onRefunded(done);
    return;
  }
  await Support.updateOne(
    { _id: support._id, status: 'paid', amountRefunded: { $ne: refunded } },
    { $set: { originalAmount: original, amountRefunded: refunded, amount: original - refunded } }
  );
}

async function refundedTotal(refund, payment) {
  if (payment?.id && payment.amount_refunded != null) return { id: payment.id, refunded: payment.amount_refunded };
  if (!refund?.payment_id) return null;
  const fetched = await getRazorpay().payments.fetch(refund.payment_id);
  return { id: fetched.id, refunded: fetched.amount_refunded };
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
    const claimed = await claimPaid(head._id, { razorpayPaymentId: payment.id, paidAt, subscriptionStatus: subscription.status });
    if (claimed) await onPaid(claimed);
    if (claimed || (await Support.exists({ razorpayPaymentId: payment.id }))) return;
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
  }).catch((err) => {
    if (err?.code === 11000) return null;
    throw err;
  });
  if (charge) await onPaid(charge, { firstCharge: false });
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
        case 'refund.processed': {
          const total = await refundedTotal(event.payload?.refund?.entity, payment);
          if (total) await recordRefund(total.id, total.refunded);
          break;
        }
        case 'payment.dispute.lost':
          if (payment?.id) await recordRefund(payment.id, payment.amount);
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
