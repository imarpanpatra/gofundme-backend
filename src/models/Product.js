import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: ['custom', 'digital', 'close-friends', 'call', 'ticket', 'physical'], default: 'custom' },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 3000, default: '' },
    price: { type: Number, required: true, min: 1 },
    image: { type: String, default: '' },
    stock: { type: Number, default: null, min: 0 },
    sold: { type: Number, default: 0 },
    question: { type: String, trim: true, maxlength: 200, default: '' },
    deliveryNote: { type: String, trim: true, maxlength: 2000, default: '' },
    deliveryUrl: { type: String, trim: true, default: '' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

productSchema.methods.toPublic = function () {
  return {
    id: this._id,
    kind: this.kind,
    title: this.title,
    description: this.description,
    price: this.price,
    image: this.image,
    soldOut: this.stock !== null && this.stock !== undefined && this.stock <= 0,
    stockLeft: this.stock ?? null,
    question: this.question,
  };
};

productSchema.methods.toStudio = function () {
  return { ...this.toPublic(), stock: this.stock ?? null, sold: this.sold, deliveryNote: this.deliveryNote, deliveryUrl: this.deliveryUrl, active: this.active };
};

export const Product = mongoose.model('Product', productSchema);
