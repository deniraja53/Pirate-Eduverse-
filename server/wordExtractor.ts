/**
 * Backend Word (.docx / .doc) Validation & Question Extractor
 * Uses mammoth for genuine .docx text extraction + embedded image detection.
 * Strictly enforces <= 2 MB limit and never fabricates missing questions/keys.
 * Created by Deni Raja99
 */

import mammoth from 'mammoth';
import type { ImportExtractionResult } from '../src/types/game.ts';
import { parseExtractedTextToQuestions } from './pdfExtractor.ts';

export const MAX_WORD_BYTES = 2 * 1024 * 1024; // 2,097,152 bytes

function isZipSignature(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05) &&
    (buffer[3] === 0x04 || buffer[3] === 0x06)
  );
}

function isLegacyOleDocSignature(buffer: Buffer): boolean {
  return (
    buffer.length >= 8 &&
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0 &&
    buffer[4] === 0xa1 &&
    buffer[5] === 0xb1 &&
    buffer[6] === 0x1a &&
    buffer[7] === 0xe1
  );
}

function isRtfSignature(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString('ascii') === '{\\rtf';
}

export function validateWordBuffer(
  buffer: Buffer,
  fileName: string
): { valid: boolean; kind?: 'docx' | 'doc_legacy' | 'doc_plain'; error?: string } {
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: 'File Word kosong atau gagal dibaca.' };
  }

  if (buffer.length > MAX_WORD_BYTES) {
    const mb = (buffer.length / (1024 * 1024)).toFixed(2);
    return {
      valid: false,
      error: `Ukuran file Word (${mb} MB) melebihi batas maksimum 2 MB (2.097.152 byte). Unggahan ditolak.`,
    };
  }

  const lowerName = (fileName || '').toLowerCase();
  if (!lowerName.endsWith('.docx') && !lowerName.endsWith('.doc')) {
    return {
      valid: false,
      error: 'Format file tidak didukung. Harap unggah dokumen Microsoft Word (.docx atau .doc).',
    };
  }

  if (isZipSignature(buffer)) {
    return { valid: true, kind: 'docx' };
  }

  if (lowerName.endsWith('.doc') && isLegacyOleDocSignature(buffer)) {
    return { valid: true, kind: 'doc_legacy' };
  }

  if (lowerName.endsWith('.doc') && !isRtfSignature(buffer)) {
    // Check if it's plain UTF-8 text saved with .doc extension
    const sample = buffer.subarray(0, Math.min(512, buffer.length));
    let nonPrintable = 0;
    for (let i = 0; i < sample.length; i++) {
      const b = sample[i];
      if (b === 0 || (b < 9 && b !== 0) || (b > 13 && b < 32)) {
        nonPrintable++;
      }
    }
    if (nonPrintable === 0 && sample.toString('utf8').trim().length >= 8) {
      return { valid: true, kind: 'doc_plain' };
    }
  }

  return {
    valid: false,
    error: lowerName.endsWith('.docx')
      ? 'File .docx rusak atau bukan arsip dokumen Word yang valid.'
      : 'Struktur file .doc tidak valid atau rusak. Gunakan Microsoft Word untuk menyimpan ulang sebagai .docx atau PDF.',
  };
}

export async function processWordUpload(
  buffer: Buffer,
  fileName: string,
  _mimeType?: string,
  sourceMethod: 'word' | 'drive' = 'word'
): Promise<ImportExtractionResult> {
  const check = validateWordBuffer(buffer, fileName);
  if (!check.valid || !check.kind) {
    throw new Error(check.error || 'Validasi dokumen Word gagal.');
  }

  if (check.kind === 'doc_legacy') {
    throw new Error(
      'File .doc format biner lama (Word 97-2003) terdeteksi. Demi akurasi struktur soal, buka dokumen di Microsoft Word atau Google Docs lalu simpan sebagai .docx atau ekspor ke PDF (maks 2 MB).'
    );
  }

  let rawText = '';
  let embeddedImageCount = 0;
  const warnings: string[] = [];

  if (check.kind === 'doc_plain') {
    rawText = buffer.toString('utf8');
    warnings.push('File .doc dibaca sebagai teks polos. Periksa kembali format soal di pratinjau.');
  } else {
    try {
      const [textRes, htmlRes] = await Promise.all([
        mammoth.extractRawText({ buffer }),
        mammoth.convertToHtml({ buffer }),
      ]);
      rawText = (textRes.value || '').trim();
      const htmlValue = htmlRes.value || '';
      const imgMatches = htmlValue.match(/<img\b/gi);
      embeddedImageCount = imgMatches ? imgMatches.length : 0;

      if (embeddedImageCount > 0) {
        warnings.push(
          `Terdeteksi ${embeddedImageCount} gambar tertanam di dokumen Word. Gambar tidak dipasang otomatis ke nomor soal agar tidak tertukar—silakan unggah gambar per soal di Editor & Pratinjau.`
        );
      }
    } catch (err) {
      throw new Error(
        `Dokumen .docx gagal dibaca (${err instanceof Error ? err.message : 'file rusak atau terenkripsi'}).`
      );
    }
  }

  if (!rawText || rawText.replace(/\s+/g, '').length < 8) {
    return {
      success: true,
      sourceMethod,
      fileName,
      fileSizeBytes: buffer.length,
      pageCount: 1,
      isScanned: false,
      ocrAvailable: false,
      ocrUsed: false,
      embeddedImageCount,
      recognizedCount: 0,
      needsReviewCount: 0,
      rawText,
      questions: [],
      warnings: [
        ...warnings,
        'Dokumen Word tidak mengandung teks soal yang dapat diekstrak.',
      ],
      message: 'Dokumen Word kosong atau hanya berisi gambar tanpa teks.',
    };
  }

  const parsed = parseExtractedTextToQuestions(
    rawText,
    sourceMethod === 'drive' ? 'drive' : 'word_docx'
  );
  const allWarnings = [...warnings, ...parsed.warnings];

  return {
    success: true,
    sourceMethod,
    fileName,
    fileSizeBytes: buffer.length,
    pageCount: 1,
    isScanned: false,
    ocrAvailable: false,
    ocrUsed: false,
    embeddedImageCount,
    recognizedCount: parsed.questions.length,
    needsReviewCount: parsed.summary.needsReviewCount,
    rawText,
    questions: parsed.questions,
    warnings: allWarnings,
    summary: parsed.summary,
    message:
      parsed.questions.length > 0
        ? `Berhasil mengekstrak ${parsed.questions.length} soal dari dokumen Word "${fileName}" (${parsed.summary.matchedKeysCount} kunci cocok otomatis).`
        : 'Dokumen Word terbaca, tetapi format nomor soal (misal "1. ...") belum terdeteksi otomatis.',
  };
}
