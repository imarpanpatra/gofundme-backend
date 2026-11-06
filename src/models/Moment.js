import mongoose from 'mongoose';

const momentSchema = new mongoose.Schema(
  {
    creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    day: { type: Number, required: true, min: 1, max: 365 },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    place: { type: String, trim: true, maxlength: 100, default: '' },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    image: { type: String, default: '' },
    cost: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

momentSchema.methods.toPublic = function (stats = {}) {
  return {
    id: this._id,
    day: this.day,
    title: this.title,
    place: this.place,
    description: this.description,
    image: this.image,
    cost: this.cost,
    raised: stats.raised || 0,
    sponsors: stats.sponsors || 0,
    active: this.active,
  };
};

export const Moment = mongoose.model('Moment', momentSchema);
