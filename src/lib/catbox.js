import https from 'node:https';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

const CATBOX_API = 'https://catbox.moe/user/api.php';
export const EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/webm': '.webm',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'application/pdf': '.pdf',
  'application/zip': '.zip',
};

export const baseType = (contentType) => String(contentType || '').split(';')[0].trim().toLowerCase();
export const isCatboxUrl = (url) => /^https:\/\/files\.catbox\.moe\/[A-Za-z0-9._-]+$/.test(String(url || ''));

function multipartBody(boundary, fields, file) {
  const parts = Object.entries(fields).map(([name, value]) =>
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)
  );
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="fileToUpload"; filename="${file.name}"\r\n` +
          `Content-Type: ${file.contentType}\r\n\r\n`
      ),
      file.buffer,
      Buffer.from('\r\n')
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(parts);
}

function post(fields, file, timeoutMs) {
  const boundary = `----gofundme${randomUUID()}`;
  const body = multipartBody(boundary, fields, file);
  return new Promise((resolve, reject) => {
    const req = https.request(
      CATBOX_API,
      {
        method: 'POST',
        family: 4,
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
          'User-Agent': 'gofundme/1.0',
        },
      },
      (res) => {
        let data = '';
        res.on('error', (e) => reject(new Error(`catbox response failed: ${e.code || e.message}`)));
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, text: data.trim() }));
      }
    );
    req.on('error', (e) => reject(new Error(`catbox unreachable: ${e.code || e.message}`)));
    req.setTimeout(timeoutMs, () => req.destroy(new Error('catbox timeout')));
    req.end(body);
  });
}

export async function uploadFile({ buffer, contentType, prefix }) {
  const type = baseType(contentType);
  const name = `${prefix}-${randomUUID()}${EXT[type] || '.bin'}`;
  const fields = { reqtype: 'fileupload' };
  if (config.catboxUserhash) fields.userhash = config.catboxUserhash;
  const res = await post(fields, { name, contentType: type || 'application/octet-stream', buffer }, 25000);
  if (!/^https:\/\/files\.catbox\.moe\/[A-Za-z0-9._-]+$/.test(res.text)) {
    const err = new Error(`Upload failed (${res.status}): ${res.text.slice(0, 120)}`);
    err.status = 502;
    throw err;
  }
  return res.text;
}

export async function deleteFile(url) {
  if (!config.catboxUserhash || !/^https:\/\/files\.catbox\.moe\//.test(String(url))) return;
  const file = String(url).split('/').pop();
  await post({ reqtype: 'deletefiles', userhash: config.catboxUserhash, files: file }, null, 15000).catch(() => {});
}

export const uploadImage = uploadFile;
export const deleteImage = deleteFile;
