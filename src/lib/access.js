import { Support } from '../models/Support.js';
import { Membership } from '../models/Membership.js';

export async function isSupporter(creatorId, actor) {
  if (!actor) return false;
  if (actor.kind === 'creator' && String(actor.id) === String(creatorId)) return true;
  const [paid, member] = await Promise.all([
    Support.exists({ creator: creatorId, account: actor.id, status: 'paid' }),
    Membership.exists({ creator: creatorId, account: actor.id, status: 'active' }),
  ]);
  return Boolean(paid || member);
}

export async function canViewPost(post, actor) {
  if (post.visibility === 'public') return true;
  if (!actor) return false;
  if (actor.kind === 'creator' && String(actor.id) === String(post.creator)) return true;
  if (post.visibility === 'followers') return true;
  return isSupporter(post.creator, actor);
}
