import { Router } from 'express';
import mongoose from 'mongoose';
import { limiter } from '../lib/limiter.js';
import { config } from '../config.js';
import { User } from '../models/User.js';
import { Support } from '../models/Support.js';
import { Product } from '../models/Product.js';
import { requireAccount } from '../middleware/auth.js';
import { startCheckout } from '../lib/checkout.js';

const router = Router();

const HOLD_MS = 30 * 60 * 1000;

async function releaseStaleHolds(productId) {
  const stale = await Support.find(
    { product: productId, type: 'shop', status: { $ne: 'paid' }, stockReserved: true, createdAt: { $lt: new Date(Date.now() - HOLD_MS) } },
    { _id: 1 }
  ).limit(50);
  for (const s of stale) {
    const released = await Support.findOneAndUpdate({ _id: s._id, status: { $ne: 'paid' }, stockReserved: true }, { $set: { stockReserved: false } });
    if (released) await Product.updateOne({ _id: productId, stock: { $ne: null } }, { $inc: { stock: 1 } });
  }
}

const buyLimiter = limiter('buyLimiter', 10 * 60 * 1000, 30);

async function findCreator(req, res) {
  const creator = await User.findBySlug(req.params.slug);
  if (!creator) res.status(404).json({ error: 'Page not found' });
  return creator;
}

router.get('/:slug', async (req, res) => {
  const creator = await findCreator(req, res);
  if (!creator) return;
  const products = await Product.find({ creator: creator._id, active: true }).sort({ createdAt: -1 });
  res.json({ products: products.map((p) => p.toPublic()) });
});

router.post('/:slug/products/:productId/order', buyLimiter, requireAccount, async (req, res) => {
  const creator = await findCreator(req, res);
  if (!creator) return;
  if (!mongoose.isValidObjectId(req.params.productId)) return res.status(404).json({ error: 'Product not found' });
  const product = await Product.findOne({ _id: req.params.productId, creator: creator._id, active: true });
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const answer = String(req.body?.answer || '').trim();
  if (product.question && !answer) return res.status(400).json({ error: `Please answer: ${product.question}` });
  if (answer.length > 1000) return res.status(400).json({ error: 'Your answer is too long' });

  const limited = product.stock !== null && product.stock !== undefined;
  if (limited) {
    await releaseStaleHolds(product._id);
    const held = await Product.updateOne({ _id: product._id, stock: { $gt: 0 } }, { $inc: { stock: -1 } });
    if (!held.modifiedCount) return res.status(409).json({ error: 'Sorry, this item is sold out' });
  }

  const support = await Support.create({
    creator: creator._id,
    account: req.actor.id,
    accountKind: req.actor.kind,
    type: 'shop',
    name: req.actor.name,
    amount: Math.round(product.price) * 100,
    currency: config.currency,
    product: product._id,
    productTitle: product.title,
    buyerAnswer: answer,
    stockReserved: limited,
  });
  const result = await startCheckout({ support, creator, actor: req.actor, extraNotes: { product: product.title } });
  if (!result.ok) {
    if (limited) {
      await Support.updateOne({ _id: support._id }, { $set: { stockReserved: false } });
      await Product.updateOne({ _id: product._id }, { $inc: { stock: 1 } });
    }
    return res.status(result.status).json({ error: result.error });
  }
  res.json({ ...result.body, productTitle: product.title });
});

export default router;
