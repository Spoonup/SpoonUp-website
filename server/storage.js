import crypto from 'crypto';
import path from 'path';
import { Storage } from '@google-cloud/storage';

const bucketName = process.env.PRODUCT_IMAGE_BUCKET || '';
const storage = new Storage();

export function isProductImageStorageConfigured() {
  return Boolean(bucketName);
}

export function isManagedProductImageUrl(value) {
  if (!bucketName || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      url.hostname === 'storage.googleapis.com' &&
      url.pathname.startsWith(`/${bucketName}/products/`);
  } catch {
    return false;
  }
}

const UPLOAD_TIMEOUT_MS = 15000;

// Validate the bytes, not just the client-supplied Content-Type header.
function sniffImageType(buffer) {
  if (buffer.length < 12) return '';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  const ascii6 = buffer.subarray(0, 6).toString('latin1');
  if (ascii6 === 'GIF87a' || ascii6 === 'GIF89a') return 'image/gif';
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return '';
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(message);
      err.status = 504;
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function extensionFor(contentType, filename) {
  const byType = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif'
  };
  return byType[contentType] || path.extname(filename || '').toLowerCase() || '';
}

export async function uploadProductImage(buffer, { contentType, filename }) {
  if (!isProductImageStorageConfigured()) {
    const err = new Error('Product image storage is not configured.');
    err.status = 503;
    throw err;
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    const err = new Error('Please select an image to upload.');
    err.status = 400;
    throw err;
  }
  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
  const detectedType = sniffImageType(buffer);
  if (!allowed.has(contentType) || detectedType !== contentType) {
    const err = new Error('Only JPG, PNG, WebP, and GIF images are supported.');
    err.status = 400;
    throw err;
  }

  const objectName = `products/${Date.now()}-${crypto.randomUUID()}${extensionFor(detectedType, filename)}`;
  const file = storage.bucket(bucketName).file(objectName);
  await withTimeout(
    file.save(buffer, {
      resumable: false,
      metadata: {
        contentType: detectedType,
        cacheControl: 'public, max-age=31536000, immutable'
      }
    }),
    UPLOAD_TIMEOUT_MS,
    'Image upload timed out. Please try again.'
  );
  return `https://storage.googleapis.com/${bucketName}/${objectName}`;
}
