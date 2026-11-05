import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

const membershipSchema = new mongoose.Schema(
  {
    creator: { type: ObjectId, ref: 'User', required: true, index: true },
    account: { type: ObjectId, required: true, index: true },
    accountKind: { type: String, enum: ['creator', 'supporter'], required: true },
    name: { type: String, default: '' },
    tier: { type: ObjectId, ref: 'MembershipTier', required: true },
    tierName: { type: String, required: true },
    amount: { type: Number, required: true },
    razorpaySubscriptionId: { type: String, index: true },
    status: { type: String, enum: ['created', 'active', 'halted', 'cancelled', 'completed', 'paused'], default: 'created', index: true },
    cancelRequested: { type: Boolean, default: false },
    startedAt: Date,
    endedAt: Date,
  },
  { timestamps: true }
);

export const Membership = mongoose.model('Membership', membershipSchema);
