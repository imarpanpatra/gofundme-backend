import mongoose from 'mongoose';

const planSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    razorpayPlanId: { type: String, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, index: true },
  },
  { timestamps: true }
);

planSchema.index({ amount: 1, currency: 1 }, { unique: true });

export const Plan = mongoose.model('Plan', planSchema);
