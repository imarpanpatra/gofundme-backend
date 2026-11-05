import mongoose from 'mongoose';

const contactMessageSchema = new mongoose.Schema(
  {
    creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, trim: true, maxlength: 80, required: true },
    email: { type: String, trim: true, lowercase: true, maxlength: 120, required: true },
    subject: { type: String, trim: true, maxlength: 150, default: '' },
    message: { type: String, trim: true, maxlength: 3000, required: true },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const ContactMessage = mongoose.model('ContactMessage', contactMessageSchema);
