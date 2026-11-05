import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

const commentSchema = new mongoose.Schema(
  {
    post: { type: ObjectId, ref: 'Post', required: true, index: true },
    actor: { type: ObjectId, required: true },
    actorKind: { type: String, enum: ['creator', 'supporter'], required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    text: { type: String, required: true, trim: true, maxlength: 1000 },
  },
  { timestamps: true }
);

export const Comment = mongoose.model('Comment', commentSchema);
