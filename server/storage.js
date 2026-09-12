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
  if (!allowed.has(contentType)) {
    const err = new Error('Only JPG, PNG, WebP, and GIF images are supported.');
    err.status = 400;
    throw err;
  }

  const objectName = `products/${Date.now()}-${crypto.randomUUID()}${extensionFor(contentType, filename)}`;
  const file = storage.bucket(bucketName).file(objectName);
  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType,
      cacheControl: 'public, max-age=31536000, immutable'
    }
  });
  return `https://storage.googleapis.com/${bucketName}/${objectName}`;
}
