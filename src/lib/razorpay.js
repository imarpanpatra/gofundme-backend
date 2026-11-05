import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import { config } from '../config.js';
import { Plan } from '../models/Plan.js';

export const razorpay = new Razorpay({
  key_id: config.razorpay.keyId,
  key_secret: config.razorpay.keySecret,
});

function hmac(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function verifyOrderSignature(orderId, paymentId, signature) {
  return safeEqual(hmac(`${orderId}|${paymentId}`, config.razorpay.keySecret), signature);
}

export function verifySubscriptionSignature(subscriptionId, paymentId, signature) {
  return safeEqual(hmac(`${paymentId}|${subscriptionId}`, config.razorpay.keySecret), signature);
}

export function verifyWebhookSignature(rawBody, signature) {
  if (!config.razorpay.webhookSecret || !signature) return false;
  return safeEqual(hmac(rawBody, config.razorpay.webhookSecret), signature);
}

export async function getMonthlyPlan(amount, currency) {
  const existing = await Plan.findOne({ amount, currency });
  if (existing) return existing.razorpayPlanId;
  const plan = await razorpay.plans.create({
    period: 'monthly',
    interval: 1,
    item: { name: `Monthly support ${currency} ${amount / 100}`, amount, currency },
  });
  await Plan.updateOne(
    { amount, currency },
    { $setOnInsert: { razorpayPlanId: plan.id } },
    { upsert: true }
  );
  return (await Plan.findOne({ amount, currency })).razorpayPlanId;
}
