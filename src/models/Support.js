import mongoose from 'mongoose';

const supportSchema = new mongoose.Schema(
  {
    creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, trim: true, maxlength: 60, default: '' },
    message: { type: String, trim: true, maxlength: 1000, default: '' },
    isPrivate: { type: Boolean, default: false },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    monthly: { type: Boolean, default: false },
    status: { type: String, enum: ['created', 'paid', 'failed'], default: 'created', index: true },
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
    name: this.name || 'Someone',
    message: this.isPrivate ? '' : this.message,
    amount: this.amount / 100,
    currency: this.currency,
    monthly: this.monthly,
    createdAt: this.paidAt || this.createdAt,
  };
};

export const Support = mongoose.model('Support', supportSchema);
