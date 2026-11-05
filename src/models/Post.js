import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

const postSchema = new mongoose.Schema(
  {
    creator: { type: ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 150 },
    slug: { type: String, required: true, lowercase: true, trim: true },
    html: { type: String, default: '' },
    excerpt: { type: String, default: '' },
    cover: { type: String, default: '' },
    visibility: { type: String, enum: ['public', 'followers', 'supporters'], default: 'public' },
    categories: { type: [String], default: [] },
    status: { type: String, enum: ['draft', 'published'], default: 'draft', index: true },
    publishedAt: Date,
    views: { type: Number, default: 0 },
    likes: { type: [ObjectId], default: [] },
    commentCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

postSchema.index({ creator: 1, slug: 1 }, { unique: true });

export const Post = mongoose.model('Post', postSchema);
