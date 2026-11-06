import { Router } from 'express';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { Support } from '../models/Support.js';
import { Product } from '../models/Product.js';
import { Membership } from '../models/Membership.js';
import { requireAccount } from '../middleware/auth.js';
import { ensureUsername, normalizeUsername, usernameProblem } from '../lib/username.js';
import { getRazorpay } from '../lib/razorpay.js';

const router = Router();

router.get('/overview', requireAccount, async (req, res) => {
  const account = req.actor.id;
  const [supports, memberships, subscriptions] = await Promise.all([
    Support.find({ account, status: 'paid' }).sort({ paidAt: -1 }).limit(100),
    Membership.find({ account, status: { $in: ['active', 'halted', 'paused'] } }).sort({ createdAt: -1 }),
    Support.aggregate([
      { $match: { account: new mongoose.Types.ObjectId(String(account)), type: 'tip', monthly: true, status: 'paid', razorpaySubscriptionId: { $type: 'string' } } },
      { $sort: { paidAt: 1 } },
      {
        $group: {
          _id: '$razorpaySubscriptionId',
          creator: { $first: '$creator' },
          since: { $first: '$paidAt' },
          amount: { $last: '$amount' },
          status: { $last: '$subscriptionStatus' },
        },
      },
      { $sort: { since: -1 } },
    ]),
  ]);
  const creatorIds = [...new Set([...supports, ...memberships, ...subscriptions].map((s) => String(s.creator)))];
  const productIds = supports.filter((s) => s.type === 'shop' && s.product).map((s) => s.product);
  const [creators, products] = await Promise.all([
    User.find({ _id: { $in: creatorIds } }, { name: 1, slug: 1 }),
    Product.find({ _id: { $in: productIds } }),
  ]);
  const creatorOf = new Map(creators.map((c) => [String(c._id), { name: c.name, slug: c.slug }]));
  const productOf = new Map(products.map((p) => [String(p._id), p]));

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
    monthlySupports: subscriptions
      .filter((s) => !['cancelled', 'completed', 'expired', 'cancel_requested'].includes(s.status))
      .map((s) => ({
        subscriptionId: s._id,
        creator: creatorOf.get(String(s.creator)),
        amount: s.amount / 100,
        status: s.status,
        since: s.since,
      })),
    supports: supports
      .filter((s) => s.type === 'tip')
      .slice(0, 50)
      .map((s) => ({
        id: s._id,
        creator: creatorOf.get(String(s.creator)),
        amount: s.amount / 100,
        monthly: s.monthly,
        momentTitle: s.momentTitle || '',
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
  let finalStatus = 'cancel_requested';
  try {
    await getRazorpay().subscriptions.cancel(subscriptionId, true);
  } catch (err) {
    const msg = err?.error?.description || err.message || 'Could not cancel';
    const current = await getRazorpay().subscriptions.fetch(subscriptionId).catch(() => null);
    if (!['cancelled', 'completed', 'expired'].includes(current?.status)) {
      return res.status(502).json({ error: `Could not cancel this subscription: ${msg}` });
    }
    finalStatus = current.status;
  }
  await Support.updateMany({ razorpaySubscriptionId: subscriptionId }, { subscriptionStatus: finalStatus });
  await Membership.updateMany({ razorpaySubscriptionId: subscriptionId }, { cancelRequested: true });
  res.json({ ok: true });
});

router.get('/profile', requireAccount, async (req, res) => {
  if (req.actor.kind === 'creator') return res.json({ kind: 'creator', slug: req.actor.doc.slug });
  const account = req.actor.doc;
  await ensureUsername(account);
  res.json({ kind: 'supporter', username: account.username, name: account.name, bio: account.bio || '', profilePublic: account.profilePublic !== false });
});

router.put('/profile', requireAccount, async (req, res) => {
  if (req.actor.kind === 'creator') return res.status(400).json({ error: 'Your public page is your profile' });
  const account = req.actor.doc;
  const { username, name, bio, profilePublic } = req.body || {};
  if (username !== undefined) {
    const next = normalizeUsername(username);
    if (next !== account.username) {
      const problem = await usernameProblem(next, account._id);
      if (problem) return res.status(400).json({ error: problem });
      account.username = next;
    }
  }
  if (name !== undefined) {
    const v = String(name).trim();
    if (!v || v.length > 60) return res.status(400).json({ error: 'Enter your name (up to 60 characters)' });
    account.name = v;
  }
  if (bio !== undefined) account.bio = String(bio).trim().slice(0, 160);
  if (profilePublic !== undefined) account.profilePublic = Boolean(profilePublic);
  try {
    await account.save();
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'That username is taken' });
    throw err;
  }
  res.json({ user: account.toPublic() });
});

export default router;
