/**
 * Backend Google Drive Import Service
 * Parses official Google Drive / Google Docs links or File IDs cleanly (no SSRF),
 * supports authenticated OAuth Bearer tokens (from Google Picker / Firebase Auth),
 * enforces strict <= 2 MB file size limit, and routes to PDF or Word question extractors.
 * Created by Deni Raja99
 */

import type { ImportExtractionResult } from '../src/types/game.ts';
import { MAX_PDF_BYTES, processPdfUpload } from './pdfExtractor.ts';
import { processWordUpload } from './wordExtractor.ts';

export interface ParsedDriveSource {
  fileId: string;
  kind: 'drive_file' | 'google_doc';
}

export function extractGoogleDriveFileId(input: string): ParsedDriveSource | null {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;

  // Direct Drive File ID from Google Picker
  if (/^[a-zA-Z0-9_-]{12,120}$/.test(trimmed)) {
    return { fileId: trimmed, kind: 'drive_file' };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    return null;
  }

  const host = parsedUrl.hostname.toLowerCase();
  if (
    host !== 'drive.google.com' &&
    host !== 'docs.google.com' &&
    host !== 'www.googleapis.com'
  ) {
    return null;
  }

  if (host === 'docs.google.com') {
    const docMatch = parsedUrl.pathname.match(/\/document\/d\/([a-zA-Z0-9_-]{10,120})/);
    if (docMatch) {
      return { fileId: docMatch[1], kind: 'google_doc' };
    }
    // Reject Google Sheets/Slides links when user expects document questions
    return null;
  }

  // drive.google.com/file/d/<id>/view
  const fileMatch = parsedUrl.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]{10,120})/);
  if (fileMatch) {
    return { fileId: fileMatch[1], kind: 'drive_file' };
  }

  // drive.google.com/open?id=<id> or /uc?id=<id>
  const queryId = parsedUrl.searchParams.get('id');
  if (queryId && /^[a-zA-Z0-9_-]{10,120}$/.test(queryId)) {
    return { fileId: queryId, kind: 'drive_file' };
  }

  return null;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function importQuestionFileFromGoogleDrive(params: {
  fileIdOrUrl: string;
  driveAccessToken?: string;
}): Promise<ImportExtractionResult> {
  const parsed = extractGoogleDriveFileId(params.fileIdOrUrl);
  if (!parsed) {
    throw new Error(
      'Tautan atau ID Google Drive tidak valid. Gunakan tautan file Google Drive (/file/d/...) atau Google Docs (/document/d/...).'
    );
  }

  const { fileId, kind } = parsed;
  const accessToken = (params.driveAccessToken || '').trim();

  // Case 1: Authenticated OAuth token from Google Sign-In / Google Picker
  if (accessToken) {
    const metaUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      fileId
    )}?fields=id,name,mimeType,size&supportsAllDrives=true`;

    const metaRes = await fetchWithTimeout(metaUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const isPastedUrl = /^https?:\/\//i.test(params.fileIdOrUrl.trim());
    let fallBackToPublicUrl = false;

    if (metaRes.status === 401 || metaRes.status === 403) {
      if (isPastedUrl) {
        fallBackToPublicUrl = true;
      } else {
        throw new Error(
          'Izin akses Google Drive tidak mencukupi atau kedaluwarsa (401/403). Silakan masuk ulang dan setujui izin file yang dipilih melalui Google Picker.'
        );
      }
    } else if (metaRes.status === 404) {
      if (isPastedUrl) {
        fallBackToPublicUrl = true;
      } else {
        throw new Error(
          'File tidak ditemukan atau belum diberi izin untuk aplikasi ini (404). Pilih file langsung melalui tombol "Pilih File via Google Picker".'
        );
      }
    } else if (!metaRes.ok) {
      throw new Error(`Gagal memeriksa metadata Google Drive (HTTP ${metaRes.status}).`);
    }

    if (!fallBackToPublicUrl) {
      const meta = (await metaRes.json()) as {
        id: string;
        name?: string;
        mimeType?: string;
        size?: string;
      };

      const fileName = meta.name || `drive-${fileId}`;
      const mimeType = meta.mimeType || '';
      const declaredSize = meta.size ? Number(meta.size) : 0;

      if (declaredSize > MAX_PDF_BYTES) {
        const mb = (declaredSize / (1024 * 1024)).toFixed(2);
        throw new Error(
          `Ukuran file "${fileName}" (${mb} MB) di Google Drive melebihi batas maksimum 2 MB.`
        );
      }

      // Export Google Docs as .docx or download binary PDF/Word
      let downloadUrl = '';
      let targetExt: 'pdf' | 'docx' | null = null;
      let exportName = fileName;

      if (mimeType === 'application/vnd.google-apps.document') {
        targetExt = 'docx';
        exportName = fileName.toLowerCase().endsWith('.docx') ? fileName : `${fileName}.docx`;
        downloadUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          fileId
        )}/export?mimeType=${encodeURIComponent(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        )}`;
      } else if (mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')) {
        targetExt = 'pdf';
        exportName = fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`;
        downloadUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          fileId
        )}?alt=media&supportsAllDrives=true`;
      } else if (
        mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        mimeType === 'application/msword' ||
        fileName.toLowerCase().endsWith('.docx') ||
        fileName.toLowerCase().endsWith('.doc')
      ) {
        targetExt = 'docx';
        downloadUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          fileId
        )}?alt=media&supportsAllDrives=true`;
      } else {
        throw new Error(
          `Format file Google Drive "${fileName}" (${mimeType || 'tidak dikenal'}) tidak didukung untuk impor soal. Gunakan file PDF, Word (.docx/.doc), atau Google Docs.`
        );
      }

      const dlRes = await fetchWithTimeout(downloadUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (dlRes.status === 401 || dlRes.status === 403) {
        throw new Error('Akses unduh file Google Drive ditolak. Pilih ulang file melalui Google Picker.');
      }
      if (!dlRes.ok) {
        throw new Error(`Gagal mengunduh isi file dari Google Drive (HTTP ${dlRes.status}).`);
      }

      const buffer = Buffer.from(await dlRes.arrayBuffer());
      if (buffer.length > MAX_PDF_BYTES) {
        const mb = (buffer.length / (1024 * 1024)).toFixed(2);
        throw new Error(`Ukuran file hasil unduhan (${mb} MB) melebihi batas maksimum 2 MB.`);
      }

      if (targetExt === 'pdf') {
        const result = await processPdfUpload(buffer, exportName, 'application/pdf', 'drive');
        return result;
      }
      return await processWordUpload(buffer, exportName, mimeType, 'drive');
    }
  }

  // Case 2: Public shared link check WITHOUT user OAuth token
  // Only works if the file is explicitly shared as "Anyone with the link"
  const publicUrl =
    kind === 'google_doc'
      ? `https://docs.google.com/document/d/${encodeURIComponent(fileId)}/export?format=docx`
      : `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;

  const pubRes = await fetchWithTimeout(publicUrl, {
    method: 'GET',
    redirect: 'follow',
  });

  if (pubRes.status === 401 || pubRes.status === 403) {
    throw new Error(
      'File Google Drive bersifat privat. Dengan izin akses minimal (drive.file), silakan klik "Pilih File via Google Picker" untuk memilih file pribadi Anda secara langsung tanpa membuka akses seluruh Drive.'
    );
  }
  if (pubRes.status === 404) {
    throw new Error('File Google Drive tidak ditemukan (404). Periksa kembali tautan yang dimasukkan.');
  }
  if (!pubRes.ok) {
    throw new Error(`Gagal mengunduh file dari Google Drive (HTTP ${pubRes.status}).`);
  }

  const contentType = (pubRes.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('text/html')) {
    throw new Error(
      'File tidak dapat diunduh langsung melalui tautan karena bersifat privat. Gunakan tombol "Pilih File via Google Picker" untuk memilih file soal Anda secara aman.'
    );
  }

  const contentLength = Number(pubRes.headers.get('content-length') || '0');
  if (contentLength > MAX_PDF_BYTES) {
    const mb = (contentLength / (1024 * 1024)).toFixed(2);
    throw new Error(`Ukuran file di Google Drive (${mb} MB) melebihi batas maksimum 2 MB.`);
  }

  const buffer = Buffer.from(await pubRes.arrayBuffer());
  if (buffer.length > MAX_PDF_BYTES) {
    const mb = (buffer.length / (1024 * 1024)).toFixed(2);
    throw new Error(`Ukuran file (${mb} MB) melebihi batas maksimum 2 MB.`);
  }

  const disp = pubRes.headers.get('content-disposition') || '';
  const nameMatch = disp.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
  const rawName = nameMatch ? decodeURIComponent(nameMatch[1]) : `drive-${fileId}`;

  if (
    contentType.includes('application/pdf') ||
    rawName.toLowerCase().endsWith('.pdf') ||
    buffer.subarray(0, 8).toString('latin1').includes('%PDF-')
  ) {
    const safeName = rawName.toLowerCase().endsWith('.pdf') ? rawName : `${rawName}.pdf`;
    return await processPdfUpload(buffer, safeName, 'application/pdf', 'drive');
  }

  if (
    kind === 'google_doc' ||
    contentType.includes('wordprocessingml') ||
    rawName.toLowerCase().endsWith('.docx') ||
    (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b)
  ) {
    const safeName = rawName.toLowerCase().endsWith('.docx') ? rawName : `${rawName}.docx`;
    return await processWordUpload(buffer, safeName, undefined, 'drive');
  }

  throw new Error(
    `Format file Google Drive (${contentType || 'tidak dikenal'}) tidak didukung. Gunakan file PDF, Word (.docx), atau Google Docs.`
  );
}
