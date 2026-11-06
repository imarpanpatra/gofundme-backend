import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    siteName: { type: String, trim: true, default: '' },
    mention: { type: String, trim: true, default: '' },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    avatar: { type: String, default: '' },
    cover: { type: String, default: '' },
    about: { type: String, default: '' },
    links: { type: [String], default: [] },
    themeColor: { type: String, default: '#5F7FFF' },
    currency: { type: String, default: 'INR' },
    suggestedAmounts: { type: [Number], default: [900, 2500, 4500] },
    supportButtonText: { type: String, default: 'Support' },
    recurringEnabled: { type: Boolean, default: true },
    featuredVideoId: { type: String, default: '' },
    membershipEnabled: { type: Boolean, default: false },
    goal: {
      amount: { type: Number, default: 0 },
      title: { type: String, trim: true, default: '' },
      raisingFor: { type: String, trim: true, default: '' },
    },
    contact: {
      legalName: { type: String, trim: true, default: '' },
      email: { type: String, trim: true, default: '' },
      phone: { type: String, trim: true, default: '' },
      address: { type: String, trim: true, default: '' },
    },
  },
  { timestamps: true }
);

userSchema.methods.toPublic = function () {
  return {
    name: this.name,
    siteName: this.siteName || '',
    mention: this.mention || '',
    slug: this.slug,
    avatar: this.avatar,
    cover: this.cover,
    about: this.about,
    links: this.links,
    themeColor: this.themeColor,
    currency: this.currency,
    suggestedAmounts: this.suggestedAmounts,
    supportButtonText: this.supportButtonText,
    recurringEnabled: this.recurringEnabled,
    featuredVideoId: this.featuredVideoId || '',
    membershipEnabled: Boolean(this.membershipEnabled),
    goal: {
      amount: this.goal?.amount || 0,
      title: this.goal?.title || '',
      raisingFor: this.goal?.raisingFor || '',
    },
    contact: {
      legalName: this.contact?.legalName || this.name,
      email: this.contact?.email || '',
      phone: this.contact?.phone || '',
      address: this.contact?.address || '',
    },
  };
};

export const User = mongoose.model('User', userSchema);
