import mongoose from 'mongoose';

const accountSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, default: '' },
    googleId: { type: String, index: true, sparse: true },
    username: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    bio: { type: String, trim: true, maxlength: 160, default: '' },
    profilePublic: { type: Boolean, default: true },
    passwordChangedAt: Date,
  },
  { timestamps: true }
);

accountSchema.methods.toPublic = function () {
  return {
    kind: 'supporter',
    id: this._id,
    name: this.name,
    email: this.email,
    username: this.username || '',
    bio: this.bio || '',
    profilePublic: this.profilePublic !== false,
    hasPassword: Boolean(this.passwordHash),
  };
};

export const Account = mongoose.model('Account', accountSchema);
