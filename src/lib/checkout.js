import { config } from '../config.js';
import { getRazorpay, getMonthlyPlan } from './razorpay.js';

function razorpayError(err) {
  return err?.error?.description || err?.message || 'Payment gateway error';
}

export async function startCheckout({ support, creator, actor, extraNotes = {} }) {
  const notes = {
    creator: creator.slug,
    supportId: support._id.toString(),
    account: actor.id.toString(),
    type: support.type,
    ...extraNotes,
  };
  const common = {
    supportId: support._id,
    keyId: config.razorpay.keyId,
    prefill: { name: actor.name, email: actor.email },
    amount: support.amount,
    currency: support.currency,
    creator: { name: creator.name, avatar: creator.avatar, themeColor: creator.themeColor },
  };

  try {
    if (support.monthly) {
      const planId = await getMonthlyPlan(support.amount, support.currency, actor.id);
      const subscription = await getRazorpay().subscriptions.create({
        plan_id: planId,
        total_count: 120,
        quantity: 1,
        customer_notify: 1,
        notes,
      });
      support.razorpaySubscriptionId = subscription.id;
      support.subscriptionStatus = subscription.status;
      await support.save();
      return { ok: true, body: { ...common, mode: 'subscription', subscriptionId: subscription.id } };
    }
    const order = await getRazorpay().orders.create({
      amount: support.amount,
      currency: support.currency,
      receipt: support._id.toString(),
      notes,
    });
    support.razorpayOrderId = order.id;
    await support.save();
    return { ok: true, body: { ...common, mode: 'order', orderId: order.id } };
  } catch (err) {
    support.status = 'failed';
    await support.save();
    if (!err?.status) console.error('Razorpay create failed:', err);
    return { ok: false, status: err?.status || 502, error: razorpayError(err) };
  }
}

export function parseAmount(amount, { wholeOnly = false } = {}) {
  const rupees = Number(amount);
  if (!Number.isFinite(rupees) || rupees < config.minAmount || rupees > config.maxAmount) return null;
  return wholeOnly ? Math.round(rupees) * 100 : Math.round(rupees * 100);
}
