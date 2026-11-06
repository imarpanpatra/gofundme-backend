import mongoose from 'mongoose';
import { Account } from '../models/Account.js';

export async function usernamesFor(ids) {
  const valid = [...new Set(ids.map(String))].filter((id) => mongoose.isValidObjectId(id) && /^[0-9a-f]{24}$/i.test(id));
  if (!valid.length) return new Map();
  const rows = await Account.find(
    { _id: { $in: valid }, username: { $exists: true, $ne: '' }, profilePublic: { $ne: false } },
    { username: 1 }
  ).lean();
  return new Map(rows.map((a) => [String(a._id), a.username]));
}

export async function withUsernames(supports) {
  const ids = supports.filter((s) => s.account && s.accountKind !== 'creator').map((s) => s.account);
  const names = await usernamesFor(ids);
  return supports.map((s) => ({ ...s.toPublic(), username: (s.account && names.get(String(s.account))) || '' }));
}
