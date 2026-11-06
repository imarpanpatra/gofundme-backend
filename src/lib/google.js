import jwt from 'jsonwebtoken';
import { config } from '../config.js';

const CERTS_URL = 'https://www.googleapis.com/oauth2/v1/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

let cache = { certs: null, expires: 0 };

async function fetchCerts() {
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error(`Google certs request failed (${res.status})`);
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') || '')?.[1]) || 3600;
  cache = { certs: await res.json(), expires: Date.now() + maxAge * 1000 };
  return cache.certs;
}

async function certFor(kid, getCerts) {
  if (getCerts) return (await getCerts())[kid];
  let certs = cache.expires > Date.now() ? cache.certs : await fetchCerts();
  if (!certs[kid]) certs = await fetchCerts();
  return certs[kid];
}

export async function verifyGoogleCredential(credential, { getCerts, clientId = config.googleClientId } = {}) {
  if (!clientId) throw Object.assign(new Error('Google sign-in is not configured'), { status: 503 });
  const decoded = jwt.decode(String(credential || ''), { complete: true });
  if (!decoded?.header?.kid) throw Object.assign(new Error('Invalid Google credential'), { status: 401 });
  const cert = await certFor(decoded.header.kid, getCerts);
  if (!cert) throw Object.assign(new Error('Invalid Google credential'), { status: 401 });
  let payload;
  try {
    payload = jwt.verify(credential, cert, { algorithms: ['RS256'], audience: clientId, issuer: ISSUERS });
  } catch {
    throw Object.assign(new Error('Invalid or expired Google credential'), { status: 401 });
  }
  if (!payload.email || payload.email_verified !== true) {
    throw Object.assign(new Error('Your Google email address is not verified'), { status: 401 });
  }
  return {
    googleId: String(payload.sub),
    email: String(payload.email).toLowerCase().trim(),
    name: String(payload.name || payload.given_name || payload.email.split('@')[0]).trim().slice(0, 60),
  };
}
