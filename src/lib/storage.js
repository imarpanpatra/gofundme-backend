import { randomUUID } from 'node:crypto';
import { put, del } from '@vercel/blob';
import * as catbox from './catbox.js';

export const { baseType } = catbox;

const blobToken = () => (process.env.BLOB_READ_WRITE_TOKEN || '').trim();
const blobStoreId = () => blobToken().split('_')[3]?.toLowerCase() || '';
const BLOB_URL = /^https:\/\/([a-z0-9]+)\.public\.blob\.vercel-storage\.com\/[A-Za-z0-9._/-]+$/;

const isBlobUrl = (url) => {
  const m = BLOB_URL.exec(String(url || ''));
  if (!m) return false;
  const id = blobStoreId();
  return !id || m[1] === id;
};

export const isStoredFileUrl = (url) => catbox.isCatboxUrl(url) || isBlobUrl(url);

export async function uploadFile({ buffer, contentType, prefix }) {
  if (!blobToken()) return catbox.uploadFile({ buffer, contentType, prefix });
  const type = baseType(contentType);
  const path = `${prefix}/${randomUUID()}${catbox.EXT[type] || '.bin'}`;
  try {
    const blob = await put(path, buffer, {
      access: 'public',
      contentType: type || 'application/octet-stream',
      token: blobToken(),
      addRandomSuffix: false,
      cacheControlMaxAge: 365 * 24 * 60 * 60,
    });
    return blob.url;
  } catch (err) {
    console.error('Blob upload failed:', err.message);
    throw Object.assign(new Error("Upload failed. Please try again in a moment."), { status: 502 });
  }
}

export async function deleteFile(url) {
  if (isBlobUrl(url)) {
    if (blobToken()) await del(url, { token: blobToken() }).catch(() => {});
    return;
  }
  await catbox.deleteFile(url);
}
