import { Support } from '../models/Support.js';
import { usernamesFor } from './profiles.js';

const IST_OFFSET_MS = 330 * 60 * 1000;

export function startOfMonthIST(now = Date.now()) {
  const ist = new Date(now + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - IST_OFFSET_MS);
}

const personKey = {
  $cond: [
    { $ifNull: ['$account', false] },
    { $toString: '$account' },
    {
      $cond: [
        { $gt: [{ $strLenCP: { $ifNull: ['$name', ''] } }, 0] },
        { $concat: ['n:', { $toLower: '$name' }] },
        { $toString: '$_id' },
      ],
    },
  ],
};

function people(creatorId, since) {
  const match = { creator: creatorId, status: 'paid' };
  if (since) match.paidAt = { $gte: since };
  return [
    { $match: match },
    { $sort: { paidAt: -1 } },
    {
      $group: {
        _id: personKey,
        total: { $sum: '$amount' },
        count: { $sum: 1 },
        names: { $push: '$name' },
        monthly: { $max: '$monthly' },
        lastAt: { $first: '$paidAt' },
        firstAt: { $last: '$paidAt' },
      },
    },
    {
      $addFields: {
        name: {
          $ifNull: [{ $arrayElemAt: [{ $filter: { input: '$names', cond: { $gt: [{ $strLenCP: '$$this' }, 0] } } }, 0] }, ''],
        },
      },
    },
  ];
}

const shape = (row, viewerId, rank, usernames) => ({
  ...(rank ? { rank } : {}),
  username: usernames?.get(String(row._id)) || '',
  name: row.name || 'Anonymous supporter',
  total: row.total / 100,
  count: row.count,
  monthly: Boolean(row.monthly),
  since: row.firstAt,
  lastAt: row.lastAt,
  isYou: Boolean(viewerId && row._id === viewerId),
});

export async function leaderboard(creatorId, { period = 'all', viewerId, limit = 10 } = {}) {
  const since = period === 'month' ? startOfMonthIST() : null;
  const [result] = await Support.aggregate([
    ...people(creatorId, since),
    {
      $facet: {
        top: [{ $sort: { total: -1, firstAt: 1 } }, { $limit: limit }],
        stats: [{ $group: { _id: null, supporters: { $sum: 1 }, supports: { $sum: '$count' }, raised: { $sum: '$total' } } }],
      },
    },
  ]);
  const stats = result.stats[0] || { supporters: 0, supports: 0, raised: 0 };
  const usernames = await usernamesFor(result.top.map((r) => r._id));
  return {
    period,
    since,
    stats: { supporters: stats.supporters, supports: stats.supports, raised: stats.raised / 100 },
    leaderboard: result.top.map((row, i) => shape(row, viewerId, i + 1, usernames)),
  };
}

export async function supporterList(creatorId, { page = 1, pageSize = 20, viewerId } = {}) {
  const [result] = await Support.aggregate([
    ...people(creatorId, null),
    {
      $facet: {
        rows: [{ $sort: { lastAt: -1 } }, { $skip: (page - 1) * pageSize }, { $limit: pageSize }],
        count: [{ $count: 'n' }],
      },
    },
  ]);
  const total = result.count[0]?.n || 0;
  const usernames = await usernamesFor(result.rows.map((r) => r._id));
  return {
    supporters: result.rows.map((row) => shape(row, viewerId, undefined, usernames)),
    page,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    total,
  };
}
