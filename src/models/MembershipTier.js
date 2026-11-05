import mongoose from 'mongoose';

const tierSchema = new mongoose.Schema(
  {
    creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    price: { type: Number, required: true, min: 1 },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    perks: { type: [String], default: [] },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

tierSchema.methods.toPublic = function () {
  return {
    id: this._id,
    name: this.name,
    price: this.price,
    description: this.description,
    perks: this.perks,
    active: this.active,
  };
};

export const MembershipTier = mongoose.model('MembershipTier', tierSchema);
