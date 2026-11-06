import { Moment } from '../models/Moment.js';
import { Support } from '../models/Support.js';
import { config } from '../config.js';

export async function momentStats(creatorId, momentIds) {
  const match = { creator: creatorId, status: 'paid', moment: momentIds ? { $in: momentIds } : { $exists: true } };
  const rows = await Support.aggregate([
    { $match: match },
    { $group: { _id: '$moment', raised: { $sum: '$amount' }, sponsors: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), { raised: r.raised / 100, sponsors: r.sponsors }]));
}

export async function itineraryFor(creatorId, { includeHidden = false } = {}) {
  const filter = { creator: creatorId };
  if (!includeHidden) filter.active = true;
  const moments = await Moment.find(filter).sort({ day: 1, createdAt: 1 });
  const stats = await momentStats(
    creatorId,
    moments.map((m) => m._id)
  );
  return moments.map((m) => m.toPublic(stats.get(String(m._id))));
}

export function readMoment(body) {
  const title = String(body.title || '').trim();
  const day = Number(body.day);
  const cost = body.cost === '' || body.cost === null || body.cost === undefined ? 0 : Number(body.cost);
  if (!title || title.length > 100) return { error: 'Give the moment a title (up to 100 characters)' };
  if (!Number.isInteger(day) || day < 1 || day > 365) return { error: 'Day must be a whole number from 1 to 365' };
  if (!Number.isInteger(cost) || cost < 0 || cost > config.maxAmount) return { error: 'Enter the cost in whole rupees, or 0 if it is not sponsorable' };
  if (cost > 0 && cost < config.minAmount) return { error: `A sponsorable moment must cost at least ₹${config.minAmount}` };
  const image = String(body.image || '').trim();
  if (image && !/^https:\/\//i.test(image)) return { error: 'Invalid image' };
  return {
    value: {
      title,
      day,
      cost,
      image,
      place: String(body.place || '').trim().slice(0, 100),
      description: String(body.description || '').trim().slice(0, 1000),
    },
  };
}
