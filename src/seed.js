import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { User } from './models/User.js';
import { uploadImage, deleteImage } from './lib/catbox.js';

const SEED_ASSETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'seed-assets');
const reset = process.argv.includes('--reset');

const about = [
  '<p>Help Me Explore Vietnam 🇻🇳</p>',
  "<p>Hey! I'm planning a trip to Vietnam to explore its beautiful landscapes, experience its culture, try authentic local food, meet new people, and discover everything this amazing country has to offer.</p>",
  "<p>I'm raising a little support to make this journey possible. Your coffee contribution will help me cover travel experiences, local food, transportation, and exploring some of Vietnam's most beautiful places.</p>",
  "<p>But this isn't just about my trip! I want to share the entire experience with you through real travel stories, photos, videos, practical travel tips, hidden gems, food recommendations, and honest insights.</p>",
  "<p>Think of it as exploring Vietnam together. I'll experience it first-hand, and you'll get inspiration and useful information for planning your own adventure!</p>",
  '<p><strong>Every coffee makes a difference. Thank you for being part of my journey!</strong></p>',
].join('');

async function storeAsset(file, prefix) {
  const src = path.join(SEED_ASSETS_DIR, file);
  if (!fs.existsSync(src)) return '';
  return uploadImage({ buffer: fs.readFileSync(src), contentType: 'image/jpeg', prefix });
}

const email = process.env.SEED_EMAIL;
const password = process.env.SEED_PASSWORD;
if (!email || !password) {
  console.error('Set SEED_EMAIL and SEED_PASSWORD in server/.env');
  process.exit(1);
}

if (!config.mongoUri) {
  console.error('Set MONGO_URI in .env or the environment');
  process.exit(1);
}

await mongoose.connect(config.mongoUri);

const login = { email, passwordHash: await bcrypt.hash(password, 12) };
const existing = await User.findOne({ slug: config.defaultCreator });

if (existing && !reset) {
  Object.assign(existing, login);
  await existing.save();
  console.log(`Updated login for "${existing.slug}" (page content untouched). Use --reset to restore the original page.`);
} else {
  const user =
    existing ||
    new User({ name: 'Arpan Patra', slug: config.defaultCreator, ...login });
  const previous = existing ? [existing.avatar, existing.cover] : [];
  Object.assign(user, login, {
    name: 'Arpan Patra',
    avatar: await storeAsset('avatar.jpg', 'avatar'),
    cover: await storeAsset('cover.jpg', 'cover'),
    about,
    links: ['https://imarpan.in'],
    themeColor: '#5F7FFF',
    currency: 'INR',
    suggestedAmounts: [900, 2500, 4500],
    supportButtonText: 'Support',
    recurringEnabled: true,
    contact: { legalName: 'Arpan Patra', email: 'hello@imarpan.in', phone: '', address: '' },
  });
  await user.save();
  await Promise.all(previous.filter((url) => url && url !== user.avatar && url !== user.cover).map(deleteImage));
  console.log(`Seeded creator "${user.slug}" — log in with ${email}`);
}

await mongoose.disconnect();
