import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

const supportSchema = new mongoose.Schema(
  {
    creator: { type: ObjectId, ref: 'User', required: true, index: true },
    account: { type: ObjectId, index: true },
    accountKind: { type: String, enum: ['creator', 'supporter'] },
    type: { type: String, enum: ['tip', 'membership', 'shop'], default: 'tip', index: true },
    name: { type: String, trim: true, maxlength: 60, default: '' },
    message: { type: String, trim: true, maxlength: 1000, default: '' },
    isPrivate: { type: Boolean, default: false },
    videoUrl: { type: String, default: '' },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    monthly: { type: Boolean, default: false },
    tier: { type: ObjectId, ref: 'MembershipTier' },
    tierName: { type: String, default: '' },
    product: { type: ObjectId, ref: 'Product' },
    productTitle: { type: String, default: '' },
    moment: { type: ObjectId, ref: 'Moment', index: true, sparse: true },
    momentTitle: { type: String, default: '' },
    buyerAnswer: { type: String, trim: true, maxlength: 1000, default: '' },
    stockReserved: { type: Boolean, default: false },
    status: { type: String, enum: ['created', 'paid', 'failed', 'refunded'], default: 'created', index: true },
    originalAmount: Number,
    amountRefunded: Number,
    razorpayOrderId: { type: String, index: true, sparse: true },
    razorpaySubscriptionId: { type: String, index: true, sparse: true },
    razorpayPaymentId: { type: String, unique: true, sparse: true },
    subscriptionStatus: { type: String, default: '' },
    paidAt: Date,
  },
  { timestamps: true }
);

supportSchema.methods.toPublic = function () {
  return {
    id: this._id,
    type: this.type || 'tip',
    name: this.name || 'Someone',
    message: this.isPrivate ? '' : this.message,
    videoUrl: this.isPrivate ? '' : this.videoUrl,
    amount: this.amount / 100,
    currency: this.currency,
    monthly: this.monthly,
    tierName: this.tierName,
    productTitle: this.productTitle,
    momentTitle: this.momentTitle || '',
    createdAt: this.paidAt || this.createdAt,
  };
};

export const Support = mongoose.model('Support', supportSchema);
