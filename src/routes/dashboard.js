import { Router } from 'express';
import { Support } from '../models/Support.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const PAGE_SIZE = 20;

router.get('/', requireAuth, async (req, res) => {
  const creator = req.user._id;
  const status = ['paid', 'created', 'failed'].includes(req.query.status) ? req.query.status : 'paid';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const since = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const sum = async (match) => {
    const [row] = await Support.aggregate([
      { $match: { creator, status: 'paid', ...match } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);
    return { total: (row?.total || 0) / 100, count: row?.count || 0 };
  };

  const [allTime, last30, last7, activeMonthly, total, rows] = await Promise.all([
    sum({}),
    sum({ paidAt: { $gte: since(30) } }),
    sum({ paidAt: { $gte: since(7) } }),
    Support.distinct('razorpaySubscriptionId', { creator, monthly: true, status: 'paid', subscriptionStatus: 'active' }),
    Support.countDocuments({ creator, status }),
    Support.find({ creator, status })
      .sort({ createdAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE),
  ]);

  res.json({
    stats: { allTime, last30, last7, activeMonthly: activeMonthly.length },
    supports: rows.map((s) => ({
      id: s._id,
      name: s.name || 'Someone',
      message: s.message,
      isPrivate: s.isPrivate,
      amount: s.amount / 100,
      currency: s.currency,
      monthly: s.monthly,
      status: s.status,
      paymentId: s.razorpayPaymentId || '',
      subscriptionStatus: s.subscriptionStatus,
      createdAt: s.paidAt || s.createdAt,
    })),
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
});

export default router;
