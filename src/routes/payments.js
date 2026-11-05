import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { User } from '../models/User.js';
import { Support } from '../models/Support.js';
import {
  razorpay,
  getMonthlyPlan,
  verifyOrderSignature,
  verifySubscriptionSignature,
  verifyWebhookSignature,
} from '../lib/razorpay.js';

const router = Router();

const orderLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

function razorpayError(err) {
  return err?.error?.description || err?.message || 'Payment gateway error';
}

router.post('/order', orderLimiter, async (req, res) => {
  const { slug, amount, name, message, isPrivate, monthly } = req.body || {};
  const creator = await User.findOne({ slug: String(slug || '').toLowerCase() });
  if (!creator) return res.status(404).json({ error: 'Page not found' });

  const rupees = Number(amount);
  if (!Number.isFinite(rupees) || rupees < config.minAmount || rupees > config.maxAmount) {
    return res.status(400).json({
      error: `Enter an amount between ₹${config.minAmount} and ₹${config.maxAmount.toLocaleString('en-IN')}`,
    });
  }
  const isMonthly = Boolean(monthly) && creator.recurringEnabled;
  const paise = isMonthly ? Math.round(rupees) * 100 : Math.round(rupees * 100);

  const support = await Support.create({
    creator: creator._id,
    name: String(name || '').trim().slice(0, 60),
    message: String(message || '').trim().slice(0, 1000),
    isPrivate: Boolean(isPrivate),
    amount: paise,
    currency: config.currency,
    monthly: isMonthly,
  });

  const notes = { creator: creator.slug, supportId: support._id.toString() };
  const common = {
    supportId: support._id,
    keyId: config.razorpay.keyId,
    amount: paise,
    currency: config.currency,
    creator: { name: creator.name, avatar: creator.avatar, themeColor: creator.themeColor },
  };

  try {
    if (isMonthly) {
      const planId = await getMonthlyPlan(paise, config.currency);
      const subscription = await razorpay.subscriptions.create({
        plan_id: planId,
        total_count: 120,
        quantity: 1,
        customer_notify: 1,
        notes,
      });
      support.razorpaySubscriptionId = subscription.id;
      support.subscriptionStatus = subscription.status;
      await support.save();
      return res.json({ ...common, mode: 'subscription', subscriptionId: subscription.id });
    }

    const order = await razorpay.orders.create({
      amount: paise,
      currency: config.currency,
      receipt: support._id.toString(),
      notes,
    });
    support.razorpayOrderId = order.id;
    await support.save();
    res.json({ ...common, mode: 'order', orderId: order.id });
  } catch (err) {
    support.status = 'failed';
    await support.save();
    console.error('Razorpay create failed:', err);
    res.status(502).json({ error: razorpayError(err) });
  }
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
    return;
  }
  await Support.create({
    creator: head.creator,
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
