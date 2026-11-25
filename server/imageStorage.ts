/**
 * Secure Question Image Storage Service
 * Stores question images locally under data/uploads/questions with strict magic-byte validation
 * (PNG, JPEG, WebP), 2 MB max size, and path-traversal protection.
 * Created by Deni Raja99
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB
const SEED_QUESTION_IMAGES_DIR = path.resolve(process.cwd(), 'data', 'uploads', 'questions');
export const QUESTION_IMAGES_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), 'pirate-academy-data', 'uploads', 'questions')
  : SEED_QUESTION_IMAGES_DIR;

export interface ValidatedImageInfo {
  ext: 'png' | 'jpg' | 'webp';
  mimeType: string;
}

export function validateImageBuffer(
  buffer: Buffer,
  fileName: string
): { valid: boolean; info?: ValidatedImageInfo; error?: string } {
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: 'File gambar kosong atau gagal dibaca.' };
  }

  if (buffer.length > MAX_IMAGE_BYTES) {
    const mb = (buffer.length / (1024 * 1024)).toFixed(2);
    return {
      valid: false,
      error: `Ukuran gambar (${mb} MB) melebihi batas maksimum 2 MB.`,
    };
  }

  // Reject SVG / HTML explicitly
  const headText = buffer.subarray(0, Math.min(256, buffer.length)).toString('utf8').trim().toLowerCase();
  if (headText.startsWith('<svg') || headText.startsWith('<?xml') || headText.startsWith('<html')) {
    return {
      valid: false,
      error: 'Format SVG/HTML tidak diizinkan demi keamanan. Gunakan PNG, JPG/JPEG, atau WEBP.',
    };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { valid: true, info: { ext: 'png', mimeType: 'image/png' } };
  }

  // JPEG: FF D8 FF
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { valid: true, info: { ext: 'jpg', mimeType: 'image/jpeg' } };
  }

  // WEBP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { valid: true, info: { ext: 'webp', mimeType: 'image/webp' } };
  }

  return {
    valid: false,
    error: `File "${fileName}" bukan gambar PNG, JPG/JPEG, atau WEBP yang valid.`,
  };
}

export function saveQuestionImageBuffer(
  buffer: Buffer,
  originalName: string
): { imageUrl: string; fileName: string; sizeBytes: number; mimeType: string } {
  const check = validateImageBuffer(buffer, originalName);
  if (!check.valid || !check.info) {
    throw new Error(check.error || 'Gambar tidak valid.');
  }

  if (!fs.existsSync(QUESTION_IMAGES_DIR)) {
    fs.mkdirSync(QUESTION_IMAGES_DIR, { recursive: true });
  }

  const safeFileName = `qimg-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${check.info.ext}`;
  const fullPath = path.resolve(QUESTION_IMAGES_DIR, safeFileName);
  if (!fullPath.startsWith(QUESTION_IMAGES_DIR + path.sep)) {
    throw new Error('Lokasi penyimpanan gambar tidak sah.');
  }

  fs.writeFileSync(fullPath, buffer);
  return {
    imageUrl: `/api/question-images/${safeFileName}`,
    fileName: safeFileName,
    sizeBytes: buffer.length,
    mimeType: check.info.mimeType,
  };
}

export function resolveSafeQuestionImagePath(fileName: string): string | null {
  if (!fileName || !/^[a-zA-Z0-9._-]+$/.test(fileName)) {
    return null;
  }
  const candidates = [QUESTION_IMAGES_DIR, SEED_QUESTION_IMAGES_DIR];
  for (const dir of candidates) {
    const resolved = path.resolve(dir, fileName);
    if (resolved.startsWith(dir + path.sep) && fs.existsSync(resolved)) {
      return resolved;
    }
  }
  return null;
}

export function deleteQuestionImageByUrl(imageUrl: string | undefined): boolean {
  if (!imageUrl || !imageUrl.startsWith('/api/question-images/')) {
    return false;
  }
  const fileName = imageUrl.slice('/api/question-images/'.length);
  const fullPath = resolveSafeQuestionImagePath(fileName);
  if (!fullPath) return false;
  try {
    fs.unlinkSync(fullPath);
    return true;
  } catch {
    return false;
  }
}
