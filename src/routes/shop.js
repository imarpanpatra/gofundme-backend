import { Router } from 'express';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { User } from '../models/User.js';
import { Support } from '../models/Support.js';
import { Product } from '../models/Product.js';
import { requireAccount } from '../middleware/auth.js';
import { startCheckout } from '../lib/checkout.js';

const router = Router();

const buyLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Please wait a few minutes and try again.' } });

async function findCreator(req, res) {
  const creator = await User.findOne({ slug: String(req.params.slug).toLowerCase() });
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
  if (product.stock !== null && product.stock !== undefined && product.stock <= 0) {
    return res.status(409).json({ error: 'Sorry, this item is sold out' });
  }
  const answer = String(req.body?.answer || '').trim();
  if (product.question && !answer) return res.status(400).json({ error: `Please answer: ${product.question}` });
  if (answer.length > 1000) return res.status(400).json({ error: 'Your answer is too long' });

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
  });
  const result = await startCheckout({ support, creator, actor: req.actor, extraNotes: { product: product.title } });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.json({ ...result.body, productTitle: product.title });
});

export default router;
