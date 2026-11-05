import { Router } from 'express';
import { User } from '../models/User.js';
import { Support } from '../models/Support.js';
import { Product } from '../models/Product.js';
import { Membership } from '../models/Membership.js';
import { requireAccount } from '../middleware/auth.js';
import { getRazorpay } from '../lib/razorpay.js';

const router = Router();

router.get('/overview', requireAccount, async (req, res) => {
  const account = req.actor.id;
  const [supports, memberships] = await Promise.all([
    Support.find({ account, status: 'paid' }).sort({ paidAt: -1 }).limit(100),
    Membership.find({ account, status: { $in: ['active', 'halted', 'paused'] } }).sort({ createdAt: -1 }),
  ]);
  const creatorIds = [...new Set([...supports, ...memberships].map((s) => String(s.creator)))];
  const productIds = supports.filter((s) => s.type === 'shop' && s.product).map((s) => s.product);
  const [creators, products] = await Promise.all([
    User.find({ _id: { $in: creatorIds } }, { name: 1, slug: 1 }),
    Product.find({ _id: { $in: productIds } }),
  ]);
  const creatorOf = new Map(creators.map((c) => [String(c._id), { name: c.name, slug: c.slug }]));
  const productOf = new Map(products.map((p) => [String(p._id), p]));

  const subscriptionHeads = new Map();
  for (const s of supports) {
    if (s.type === 'tip' && s.monthly && s.razorpaySubscriptionId && !subscriptionHeads.has(s.razorpaySubscriptionId)) {
      subscriptionHeads.set(s.razorpaySubscriptionId, s);
    }
  }

  res.json({
    purchases: supports
      .filter((s) => s.type === 'shop')
      .map((s) => {
        const p = productOf.get(String(s.product));
        return {
          id: s._id,
          creator: creatorOf.get(String(s.creator)),
          title: s.productTitle,
          amount: s.amount / 100,
          answer: s.buyerAnswer,
          deliveryNote: p?.deliveryNote || '',
          deliveryUrl: p?.deliveryUrl || '',
          image: p?.image || '',
          paymentId: s.razorpayPaymentId,
          paidAt: s.paidAt,
        };
      }),
    memberships: memberships.map((m) => ({
      id: m._id,
      creator: creatorOf.get(String(m.creator)),
      tierName: m.tierName,
      amount: m.amount / 100,
      status: m.status,
      cancelRequested: m.cancelRequested,
      subscriptionId: m.razorpaySubscriptionId,
      startedAt: m.startedAt,
    })),
    monthlySupports: [...subscriptionHeads.values()]
      .filter((s) => !['cancelled', 'completed', 'cancel_requested'].includes(s.subscriptionStatus))
      .map((s) => ({
        subscriptionId: s.razorpaySubscriptionId,
        creator: creatorOf.get(String(s.creator)),
        amount: s.amount / 100,
        status: s.subscriptionStatus,
        since: s.paidAt,
      })),
    supports: supports
      .filter((s) => s.type === 'tip')
      .slice(0, 50)
      .map((s) => ({
        id: s._id,
        creator: creatorOf.get(String(s.creator)),
        amount: s.amount / 100,
        monthly: s.monthly,
        message: s.message,
        paymentId: s.razorpayPaymentId,
        paidAt: s.paidAt,
      })),
  });
});

router.post('/subscriptions/:subscriptionId/cancel', requireAccount, async (req, res) => {
  const subscriptionId = String(req.params.subscriptionId);
  const head = await Support.findOne({ razorpaySubscriptionId: subscriptionId, account: req.actor.id }).sort({ createdAt: 1 });
  if (!head) return res.status(404).json({ error: 'Subscription not found' });
  try {
    await getRazorpay().subscriptions.cancel(subscriptionId, true);
  } catch (err) {
    const msg = err?.error?.description || err.message || 'Could not cancel';
    if (!/cancel/i.test(msg)) return res.status(502).json({ error: msg });
  }
  await Support.updateMany({ razorpaySubscriptionId: subscriptionId }, { subscriptionStatus: 'cancel_requested' });
  await Membership.updateMany({ razorpaySubscriptionId: subscriptionId }, { cancelRequested: true });
  res.json({ ok: true });
});

export default router;
