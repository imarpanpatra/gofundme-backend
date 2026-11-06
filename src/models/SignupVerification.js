import mongoose from 'mongoose';

const signupVerificationSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    passwordHash: { type: String, required: true },
    signupHash: { type: String, required: true, unique: true },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    sends: { type: Number, default: 1 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

signupVerificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

export const SignupVerification = mongoose.model('SignupVerification', signupVerificationSchema);
