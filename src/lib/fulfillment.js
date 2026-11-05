import { Product } from '../models/Product.js';
import { Membership } from '../models/Membership.js';

export async function onPaid(support, { firstCharge = true } = {}) {
  if (support.type === 'shop' && support.product && firstCharge) {
    await Product.updateOne({ _id: support.product }, { $inc: { sold: 1 } });
    await Product.updateOne({ _id: support.product, stock: { $gt: 0 } }, { $inc: { stock: -1 } });
  }
  if (support.type === 'membership' && support.razorpaySubscriptionId) {
    await Membership.updateOne(
      { razorpaySubscriptionId: support.razorpaySubscriptionId, status: { $in: ['created', 'halted', 'paused'] } },
      { $set: { status: 'active' }, $min: { startedAt: support.paidAt || new Date() } }
    );
  }
}

export async function onSubscriptionStatus(subscriptionId, status) {
  const update = { status };
  if (['cancelled', 'completed'].includes(status)) update.endedAt = new Date();
  if (['created', 'active', 'halted', 'cancelled', 'completed', 'paused'].includes(status)) {
    await Membership.updateMany({ razorpaySubscriptionId: subscriptionId }, { $set: update });
  }
}
