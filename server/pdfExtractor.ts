/**
 * Backend PDF Validation, Text Extraction (pdfjs-dist), Scanned-PDF Detection,
 * Optional Gemini OCR, and Question Parser.
 * Strictly enforces 2 MB (2,097,152 bytes) limit and never fabricates missing questions or keys.
 * Created by Deni Raja99
 */

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { GoogleGenAI } from '@google/genai';
import type { PdfExtractionResult, Question, QuestionOption } from '../src/types/game.ts';
import { CHEST_PRESETS } from './db.ts';

export const MAX_PDF_BYTES = 2 * 1024 * 1024; // 2,097,152 bytes

export function validatePdfBuffer(
  buffer: Buffer,
  fileName: string,
  mimeType?: string
): { valid: boolean; error?: string } {
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: 'File kosong atau gagal dibaca.' };
  }

  if (buffer.length > MAX_PDF_BYTES) {
    const mb = (buffer.length / (1024 * 1024)).toFixed(2);
    return {
      valid: false,
      error: `Ukuran file (${mb} MB) melebihi batas maksimum 2 MB (2.097.152 byte). Upload ditolak.`,
    };
  }

  // Check extension / MIME if provided
  const lowerName = (fileName || '').toLowerCase();
  if (mimeType && mimeType !== 'application/pdf' && mimeType !== 'application/x-pdf' && !lowerName.endsWith('.pdf')) {
    return {
      valid: false,
      error: 'Format file tidak valid. Hanya file PDF asli yang diperbolehkan.',
    };
  }

  // Check actual PDF magic header "%PDF-" within first 1024 bytes
  const headerSlice = buffer.subarray(0, Math.min(1024, buffer.length)).toString('latin1');
  if (!headerSlice.includes('%PDF-')) {
    return {
      valid: false,
      error: 'Struktur file tidak valid (header %PDF- tidak ditemukan). Pastikan file bukan ekstensi palsu atau rusak.',
    };
  }

  return { valid: true };
}

interface PdfTextItemLike {
  str?: string;
  transform?: number[];
  hasEOL?: boolean;
}

/**
 * Extracts readable text page-by-page using Mozilla pdfjs-dist.
 * Reconstructs line breaks using text baseline Y coordinates.
 */
export async function extractPdfTextWithPdfJs(buffer: Buffer): Promise<{
  pageCount: number;
  rawText: string;
  pageTexts: Array<{ page: number; text: string }>;
  isScanned: boolean;
}> {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    useSystemFonts: true,
    verbosity: 0,
  });

  const pdfDoc = await loadingTask.promise;
  const pageCount = pdfDoc.numPages;
  const pageTexts: Array<{ page: number; text: string }> = [];

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const items = (textContent.items || []) as PdfTextItemLike[];

    // Group items into lines by rounded Y coordinate (transform[5])
    const lines: string[] = [];
    let currentLine = '';
    let lastY: number | null = null;

    for (const item of items) {
      const str = item.str ?? '';
      const y = Array.isArray(item.transform) ? Math.round(item.transform[5]) : null;

      if (lastY !== null && y !== null && Math.abs(y - lastY) > 4) {
        if (currentLine.trim()) {
          lines.push(currentLine.trim());
        }
        currentLine = str;
      } else {
        if (currentLine && str && !currentLine.endsWith(' ') && !str.startsWith(' ')) {
          currentLine += ' ';
        }
        currentLine += str;
      }

      if (item.hasEOL && currentLine.trim()) {
        lines.push(currentLine.trim());
        currentLine = '';
        lastY = null;
      } else if (y !== null) {
        lastY = y;
      }
    }

    if (currentLine.trim()) {
      lines.push(currentLine.trim());
    }

    pageTexts.push({
      page: pageNum,
      text: lines.join('\n'),
    });
  }

  const rawText = pageTexts.map((p) => p.text).filter(Boolean).join('\n\n');
  const meaningfulChars = rawText.replace(/\s+/g, '').length;
  const isScanned = pageCount > 0 && meaningfulChars < 30;

  return {
    pageCount,
    rawText,
    pageTexts,
    isScanned,
  };
}

/**
 * Parses extracted exam text into structured Question objects.
 * Never fabricates missing questions, options, or answer keys.
 */
export function parseExtractedTextToQuestions(
  rawText: string,
  sourceType: 'pdf_text' | 'ocr' | 'manual' = 'pdf_text',
  pageTexts?: Array<{ page: number; text: string }>
): { questions: Question[]; warnings: string[] } {
  const warnings: string[] = [];
  const normalized = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

  if (!normalized) {
    return { questions: [], warnings: ['Tidak ada teks soal yang terbaca.'] };
  }

  // Extract standalone answer-key section at the bottom if present (e.g., "Kunci Jawaban:\n1. A\n2. C")
  const globalKeysMap = new Map<number, string>();
  let bodyText = normalized;
  const keySectionMatch = normalized.match(/\n\s*(?:KUNCI\s+JAWABAN|ANSWER\s+KEY)\s*:?\s*\n([\s\S]+)$/i);
  if (keySectionMatch) {
    const keySection = keySectionMatch[1];
    const keyLines = keySection.split('\n');
    let matchedKeyPairs = 0;
    for (const line of keyLines) {
      const m = line.trim().match(/^(?:No\.?\s*|Soal\s*)?(\d+)[\.\)\:\s-]+([A-E]|.+)$/i);
      if (m) {
        globalKeysMap.set(Number(m[1]), m[2].trim());
        matchedKeyPairs++;
      }
    }
    if (matchedKeyPairs >= 2 && typeof keySectionMatch.index === 'number') {
      bodyText = normalized.slice(0, keySectionMatch.index).trim();
    }
  }

  // Split blocks by question header patterns at start of line: "1.", "1)", "Soal 1:", "No. 1."
  const lines = bodyText.split('\n');
  const blocks: Array<{ declaredNumber?: number; lines: string[] }> = [];
  let currentBlock: { declaredNumber?: number; lines: string[] } | null = null;
  let globalInstruction = '';

  const qStartRegex = /^(?:Soal\s+|No\.?\s*)?(\d{1,3})[\.\)\:]\s+(.+)$/i;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Capture top-level document instruction before Q1
    if (!currentBlock && /^(?:Petunjuk|Instruksi|Perhatikan)\s*:/i.test(line)) {
      globalInstruction = line.replace(/^(?:Petunjuk|Instruksi|Perhatikan)\s*:\s*/i, '').trim();
      continue;
    }

    const qMatch = line.match(qStartRegex);
    if (qMatch) {
      const num = parseInt(qMatch[1], 10);
      if (num > 0 && num <= 200) {
        if (currentBlock) blocks.push(currentBlock);
        currentBlock = {
          declaredNumber: num,
          lines: [qMatch[2].trim()],
        };
        continue;
      }
    }

    if (currentBlock) {
      currentBlock.lines.push(line);
    }
  }
  if (currentBlock) blocks.push(currentBlock);

  const questions: Question[] = [];
  const batchToken = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  blocks.forEach((blk, idx) => {
    const qNumber = blk.declaredNumber || idx + 1;
    let blockText = blk.lines.join('\n').trim();
    if (!blockText || blockText.length < 4) return;

    // 1. Extract explicit point weight if mentioned: (10 poin), [Bobot: 20], Bobot: 15
    let detectedPoints: number | undefined;
    const pointsMatch =
      blockText.match(/[\(\[]\s*(?:bobot|skor|nilai|poin)?\s*:?\s*(\d{1,3})\s*(?:poin|skor|nilai)?\s*[\)\]]/i) ||
      blockText.match(/(?:Bobot|Skor|Poin)\s*:\s*(\d{1,3})/i);
    if (pointsMatch) {
      const parsedPts = parseInt(pointsMatch[1], 10);
      if (parsedPts > 0 && parsedPts <= 100) {
        detectedPoints = parsedPts;
      }
      blockText = blockText.replace(pointsMatch[0], '').trim();
    }

    // 2. Extract question-specific instruction if present
    let instructions = globalInstruction || undefined;
    const instrMatch = blockText.match(/(?:Petunjuk|Instruksi|Catatan)\s*:\s*([^\n]+)/i);
    if (instrMatch) {
      instructions = instrMatch[1].trim();
      blockText = blockText.replace(instrMatch[0], '').trim();
    }

    // 3. Extract explicit answer key and optional Pembahasan/Penjelasan from inside the block (never guess!)
    let explicitKey: string | undefined = globalKeysMap.get(qNumber);
    const inlineKeyMatch = blockText.match(
      /(?:^|\n)\s*(?:Kunci\s*Jawaban|Kunci|Kata\s*Kunci|Jawaban\s*Benar)\s*[:=]\s*([^\n]+)/i
    );
    if (inlineKeyMatch) {
      explicitKey = inlineKeyMatch[1].trim();
      blockText = blockText.replace(inlineKeyMatch[0], '').trim();
    }

    let explicitExplanation: string | undefined;
    const explanationMatch = blockText.match(
      /(?:^|\n)\s*(?:Pembahasan|Penjelasan)\s*[:=]\s*([^\n]+)/i
    );
    if (explanationMatch) {
      explicitExplanation = explanationMatch[1].trim();
      blockText = blockText.replace(explanationMatch[0], '').trim();
    }

    // 4. Extract options A..E (handles both multi-line and same-line options)
    // Normalize inline options like "A. foo   B. bar" onto new lines carefully
    const optionSplitText = blockText.replace(/(?:^|\s)([A-E])([\.\)])\s+/g, '\n$1$2 ');
    const optLines = optionSplitText.split('\n').map((l) => l.trim()).filter(Boolean);

    const promptLines: string[] = [];
    const options: QuestionOption[] = [];
    let currentOpt: QuestionOption | null = null;

    for (const line of optLines) {
      const optMatch = line.match(/^([A-E])[\.\)]\s*(.+)$/);
      if (optMatch) {
        const optId = optMatch[1].toUpperCase();
        if (currentOpt) {
          if (!options.some((o) => o.id === currentOpt!.id)) {
            options.push(currentOpt);
          }
        }
        // Only start a new option if this letter hasn't already been captured in this question
        if (!options.some((o) => o.id === optId)) {
          currentOpt = {
            id: optId,
            text: optMatch[2].trim(),
          };
        } else {
          currentOpt = null;
        }
      } else if (currentOpt) {
        currentOpt.text = `${currentOpt.text} ${line}`.trim();
      } else {
        promptLines.push(line);
      }
    }
    if (currentOpt && !options.some((o) => o.id === currentOpt!.id)) {
      options.push(currentOpt);
    }

    const promptText = promptLines.join(' ').trim();
    if (!promptText) return;

    // Locate page number if pageTexts provided
    let pageFound: number | undefined;
    if (pageTexts && pageTexts.length > 0) {
      const snippet = promptText.slice(0, Math.min(28, promptText.length));
      const matchedPage = pageTexts.find((p) => p.text.includes(snippet));
      if (matchedPage) pageFound = matchedPage.page;
    }

    // Determine question type
    const isMultipleChoice = options.length >= 2;
    let type: Question['type'] = 'short_answer';
    let correctAnswer: string | undefined;
    let keywords: string[] | undefined;
    let needsReview = false;

    if (isMultipleChoice) {
      type = 'multiple_choice';
      if (explicitKey) {
        const letterMatch = explicitKey.trim().match(/^([A-E])\b/i);
        if (letterMatch) {
          correctAnswer = letterMatch[1].toUpperCase();
        } else {
          needsReview = true;
        }
      } else {
        // Never fabricate missing answer key!
        needsReview = true;
      }
      if (options.length < 3) {
        needsReview = true;
      }
    } else {
      const lowerPrompt = promptText.toLowerCase();
      const looksLikeEssay =
        lowerPrompt.includes('jelaskan') ||
        lowerPrompt.includes('uraikan') ||
        lowerPrompt.includes('mengapa') ||
        lowerPrompt.includes('bagaimana') ||
        lowerPrompt.includes('ceritakan') ||
        lowerPrompt.includes('tuliskan pendapat') ||
        blockText.includes('_____') === false && promptText.length > 95;

      type = looksLikeEssay ? 'essay' : 'short_answer';
      if (type === 'short_answer') {
        if (explicitKey) {
          keywords = explicitKey
            .split(/[,;|]/)
            .map((k) => k.trim())
            .filter(Boolean);
        } else {
          needsReview = true;
        }
      }
    }

    const ordinalNumber = questions.length + 1;
    const preset = CHEST_PRESETS[(ordinalNumber - 1) % CHEST_PRESETS.length];
    questions.push({
      id: `q-pdf-${batchToken}-${ordinalNumber}`,
      number: ordinalNumber,
      type,
      prompt: promptText,
      instructions,
      options: isMultipleChoice ? options : undefined,
      correctAnswer,
      keywords,
      essayRubric: type === 'essay' && explicitKey ? explicitKey : undefined,
      explanation: explicitExplanation || undefined,
      points: detectedPoints ?? (type === 'essay' ? 20 : type === 'short_answer' ? 15 : 10),
      needsReview,
      sourceMeta: {
        page: pageFound,
        sourceType,
        confidence: needsReview ? 'needs_review' : 'high',
      },
      chestPosition: preset,
      locationName: preset.name,
    });
  });

  if (questions.length > 0) {
    const missingKeyCount = questions.filter((q) => q.needsReview).length;
    if (missingKeyCount > 0) {
      warnings.push(
        `${missingKeyCount} soal belum memiliki kunci jawaban atau perlu pemeriksaan manual sebelum diterbitkan.`
      );
    }
  } else {
    warnings.push(
      'Teks PDF terbaca, namun pola nomor soal (misal "1. ...", "2) ...", "Soal 1:") tidak terdeteksi otomatis.'
    );
  }

  return { questions, warnings };
}

/**
 * Full PDF upload + extraction handler
 */
export async function processPdfUpload(
  buffer: Buffer,
  fileName: string,
  mimeType?: string
): Promise<PdfExtractionResult> {
  const validation = validatePdfBuffer(buffer, fileName, mimeType);
  if (!validation.valid) {
    throw new Error(validation.error || 'Validasi PDF gagal.');
  }

  const pdfResult = await extractPdfTextWithPdfJs(buffer);
  const ocrAvailable = Boolean(process.env.GEMINI_API_KEY);

  if (pdfResult.isScanned) {
    return {
      success: true,
      fileName,
      fileSizeBytes: buffer.length,
      pageCount: pdfResult.pageCount,
      isScanned: true,
      ocrAvailable,
      ocrUsed: false,
      rawText: '',
      questions: [],
      warnings: [
        'PDF ini merupakan hasil scan/gambar dan tidak memiliki lapisan teks yang dapat diekstrak langsung.',
      ],
      message: ocrAvailable
        ? 'PDF scan terdeteksi. Anda dapat menjalankan OCR untuk membaca teks atau mengunggah PDF berbasis teks.'
        : 'PDF scan terdeteksi (tidak ada teks yang bisa diekstrak tanpa OCR). Gunakan PDF berbasis teks, aktifkan GEMINI_API_KEY di server untuk OCR, atau masukkan soal secara manual.',
    };
  }

  const parsed = parseExtractedTextToQuestions(pdfResult.rawText, 'pdf_text', pdfResult.pageTexts);

  return {
    success: true,
    fileName,
    fileSizeBytes: buffer.length,
    pageCount: pdfResult.pageCount,
    isScanned: false,
    ocrAvailable,
    ocrUsed: false,
    rawText: pdfResult.rawText,
    questions: parsed.questions,
    warnings: parsed.warnings,
    message:
      parsed.questions.length > 0
        ? `Berhasil mengekstrak ${parsed.questions.length} soal dari ${pdfResult.pageCount} halaman PDF.`
        : 'PDF berhasil dibaca, tetapi tidak ditemukan format soal bernomor yang dikenali.',
  };
}

/**
 * Explicit OCR flow for scanned/image PDFs using server-side Gemini API (@google/genai).
 * Strictly transcribes existing content without inventing questions or keys.
 */
export async function runOcrOnPdfBuffer(
  buffer: Buffer,
  fileName: string,
  mimeType?: string
): Promise<PdfExtractionResult> {
  const validation = validatePdfBuffer(buffer, fileName, mimeType);
  if (!validation.valid) {
    throw new Error(validation.error || 'Validasi PDF gagal.');
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Layanan OCR server belum dikonfigurasi (GEMINI_API_KEY tidak tersedia). Silakan unggah PDF berbasis teks atau ketik soal secara manual.'
    );
  }

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: [
      {
        inlineData: {
          mimeType: 'application/pdf',
          data: buffer.toString('base64'),
        },
      },
      `Transkripkan seluruh teks soal ujian dari dokumen PDF scan ini secara persis sesuai aslinya.
ATURAN KETAT:
1. Pertahankan nomor soal (1., 2., dst.), teks pertanyaan, opsi A/B/C/D, bobot poin, instruksi, kunci jawaban, dan pembahasan (jika tertulis) persis seperti di dokumen.
2. JANGAN mengarang soal baru, JANGAN mengarang opsi jawaban, JANGAN mengarang pembahasan, dan JANGAN menebak kunci jawaban jika tidak tertulis di dokumen.
3. Keluarkan hanya hasil transkripsi teks yang rapi berurutan tanpa komentar tambahan.`,
    ],
  });

  const ocrText = (response.text || '').trim();
  if (!ocrText || ocrText.length < 15) {
    throw new Error('OCR tidak berhasil membaca teks soal dari PDF scan tersebut.');
  }

  const parsed = parseExtractedTextToQuestions(ocrText, 'ocr');
  return {
    success: true,
    fileName,
    fileSizeBytes: buffer.length,
    pageCount: 1,
    isScanned: true,
    ocrAvailable: true,
    ocrUsed: true,
    rawText: ocrText,
    questions: parsed.questions,
    warnings: parsed.warnings,
    message: `OCR selesai: ${parsed.questions.length} soal berhasil dibaca. Harap periksa kembali seluruh soal sebelum diterbitkan.`,
  };
}
