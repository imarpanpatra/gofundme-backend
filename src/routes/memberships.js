import { Router } from 'express';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { User } from '../models/User.js';
import { Support } from '../models/Support.js';
import { MembershipTier } from '../models/MembershipTier.js';
import { Membership } from '../models/Membership.js';
import { requireAccount, optionalActor } from '../middleware/auth.js';
import { startCheckout } from '../lib/checkout.js';

const router = Router();

const joinLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Please wait a few minutes and try again.' } });

router.get('/:slug', async (req, res) => {
  const creator = await User.findOne({ slug: String(req.params.slug).toLowerCase() });
  if (!creator) return res.status(404).json({ error: 'Page not found' });
  if (!creator.membershipEnabled) return res.json({ enabled: false, tiers: [], membership: null });
  const actor = await optionalActor(req);
  const [tiers, membership, memberCount] = await Promise.all([
    MembershipTier.find({ creator: creator._id, active: true }).sort({ price: 1 }),
    actor ? Membership.findOne({ creator: creator._id, account: actor.id, status: 'active' }) : null,
    Membership.countDocuments({ creator: creator._id, status: 'active' }),
  ]);
  res.json({
    enabled: true,
    memberCount,
    tiers: tiers.map((t) => t.toPublic()),
    membership: membership && {
      id: membership._id,
      tierId: membership.tier,
      tierName: membership.tierName,
      amount: membership.amount / 100,
      cancelRequested: membership.cancelRequested,
      startedAt: membership.startedAt,
    },
  });
});

router.post('/:slug/tiers/:tierId/join', joinLimiter, requireAccount, async (req, res) => {
  const creator = await User.findOne({ slug: String(req.params.slug).toLowerCase() });
  if (!creator || !creator.membershipEnabled) return res.status(404).json({ error: 'Memberships are not available' });
  if (!mongoose.isValidObjectId(req.params.tierId)) return res.status(404).json({ error: 'Tier not found' });
  const tier = await MembershipTier.findOne({ _id: req.params.tierId, creator: creator._id, active: true });
  if (!tier) return res.status(404).json({ error: 'Tier not found' });
  if (await Membership.exists({ creator: creator._id, account: req.actor.id, status: 'active' })) {
    return res.status(409).json({ error: "You're already a member. Cancel your current membership from your account to switch tiers." });
  }

  const amount = Math.round(tier.price) * 100;
  const support = await Support.create({
    creator: creator._id,
    account: req.actor.id,
    accountKind: req.actor.kind,
    type: 'membership',
    name: req.actor.name,
    amount,
    currency: config.currency,
    monthly: true,
    tier: tier._id,
    tierName: tier.name,
  });
  const result = await startCheckout({ support, creator, actor: req.actor, extraNotes: { tier: tier.name } });
  if (!result.ok) return res.status(result.status).json({ error: result.error });

  await Membership.create({
    creator: creator._id,
    account: req.actor.id,
    accountKind: req.actor.kind,
    name: req.actor.name,
    tier: tier._id,
    tierName: tier.name,
    amount,
    razorpaySubscriptionId: support.razorpaySubscriptionId,
  });
  res.json({ ...result.body, tierName: tier.name });
});

export default router;
