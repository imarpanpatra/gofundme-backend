import mongoose from 'mongoose';

const accountSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, default: '' },
    googleId: { type: String, index: true, sparse: true },
  },
  { timestamps: true }
);

accountSchema.methods.toPublic = function () {
  return { kind: 'supporter', id: this._id, name: this.name, email: this.email };
};

export const Account = mongoose.model('Account', accountSchema);
