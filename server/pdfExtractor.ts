/**
 * Backend PDF Validation, Text Extraction (pdfjs-dist), Scanned-PDF Detection,
 * Optional Gemini OCR, Multi-Format Answer Key Matcher, and 6-Type Question Parser.
 * Strictly enforces 2 MB (2,097,152 bytes) limit and never fabricates missing questions or keys.
 * Created by Deni Raja99
 */

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { GoogleGenAI } from '@google/genai';
import {
  ALL_QUESTION_TYPES,
  type AnswerSource,
  type AnswerStatus,
  type ImportExtractionResult,
  type ImportExtractionSummary,
  type MatchingPair,
  type PdfExtractionResult,
  type Question,
  type QuestionOption,
  type QuestionType,
} from '../src/types/game.ts';
import {
  normalizeTrueFalseValue,
  validateQuestion,
} from '../src/teacher/questionValidation.ts';
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

  const lowerName = (fileName || '').toLowerCase();
  if (
    mimeType &&
    mimeType !== 'application/pdf' &&
    mimeType !== 'application/x-pdf' &&
    !lowerName.endsWith('.pdf')
  ) {
    return {
      valid: false,
      error: 'Format file tidak valid. Hanya file PDF asli yang diperbolehkan.',
    };
  }

  const headerSlice = buffer.subarray(0, Math.min(1024, buffer.length)).toString('latin1');
  if (!headerSlice.includes('%PDF-')) {
    return {
      valid: false,
      error:
        'Struktur file tidak valid (header %PDF- tidak ditemukan). Pastikan file bukan ekstensi palsu atau rusak.',
    };
  }

  return { valid: true };
}

interface PdfTextItemLike {
  str?: string;
  transform?: number[];
  width?: number;
  hasEOL?: boolean;
}

interface PositionedTextItem {
  str: string;
  x: number;
  y: number;
  endX: number;
}

function normalizeHeaderFooterFingerprint(line: string): string {
  return line
    .trim()
    .toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ');
}

function isLikelyRunningHeaderOrFooter(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^(?:halaman|hal\.?|page)\s+\d+(?:\s*(?:dari|of|\/)\s*\d+)?$/i.test(trimmed)) return true;
  if (/^-\s*\d+\s*-$/.test(trimmed)) return true;
  if (/^(?:naskah\s+soal|lembar\s+soal|asesmen\s+sumatif|ulangan\s+akhir|ujian\s+akhir)/i.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * Extracts readable text page-by-page using Mozilla pdfjs-dist.
 * Sorts items by baseline Y (descending) and X (ascending), preserving wide column gaps
 * so multi-column tables and horizontal answer-key grids remain parseable,
 * and removes repeating running page headers/footers across pages.
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

  try {
    const pdfDoc = await loadingTask.promise;
    const pageCount = pdfDoc.numPages;
    const rawPages: Array<{ page: number; lines: string[] }> = [];

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const rawItems = (textContent.items || []) as PdfTextItemLike[];

      const positioned: PositionedTextItem[] = [];
      for (const item of rawItems) {
        const str = item.str ?? '';
        if (!str) continue;
        const x = Array.isArray(item.transform) ? Number(item.transform[4] || 0) : 0;
        const y = Array.isArray(item.transform) ? Number(item.transform[5] || 0) : 0;
        const width = typeof item.width === 'number' ? item.width : str.length * 4;
        positioned.push({
          str,
          x,
          y,
          endX: x + width,
        });
      }

      // Sort top-to-bottom (higher Y first in PDF coordinates), then left-to-right
      positioned.sort((a, b) => {
        if (Math.abs(a.y - b.y) > 4.5) {
          return b.y - a.y;
        }
        return a.x - b.x;
      });

      const rows: PositionedTextItem[][] = [];
      for (const item of positioned) {
        const lastRow = rows[rows.length - 1];
        if (!lastRow || Math.abs(lastRow[0].y - item.y) > 4.5) {
          rows.push([item]);
        } else {
          lastRow.push(item);
        }
      }

      const lines: string[] = [];
      for (const row of rows) {
        row.sort((a, b) => a.x - b.x);
        let line = '';
        let prevEndX: number | null = null;
        for (const cell of row) {
          const text = cell.str;
          if (!text.trim()) continue;
          if (prevEndX !== null) {
            const gap = cell.x - prevEndX;
            if (gap > 18) {
              // Wide gap likely separates table columns / multi-column answer keys
              line += '   ';
            } else if (!line.endsWith(' ') && !text.startsWith(' ')) {
              line += ' ';
            }
          }
          line += text;
          prevEndX = Math.max(prevEndX ?? cell.endX, cell.endX);
        }
        const trimmedLine = line.replace(/\u00a0/g, ' ').trim();
        if (trimmedLine) {
          lines.push(trimmedLine);
        }
      }

      rawPages.push({ page: pageNum, lines });
    }

    // Detect repeating header/footer fingerprints across pages (if >= 2 pages)
    const edgeCounts = new Map<string, number>();
    if (pageCount >= 2) {
      for (const p of rawPages) {
        const candidates = [
          ...p.lines.slice(0, 2),
          ...p.lines.slice(Math.max(0, p.lines.length - 2)),
        ];
        const uniqueOnPage = new Set(candidates.map(normalizeHeaderFooterFingerprint));
        for (const fp of uniqueOnPage) {
          if (fp.length >= 4) {
            edgeCounts.set(fp, (edgeCounts.get(fp) || 0) + 1);
          }
        }
      }
    }

    const pageTexts: Array<{ page: number; text: string }> = rawPages.map((p) => {
      const filteredLines = p.lines.filter((line, idx) => {
        const isEdge = idx < 2 || idx >= p.lines.length - 2;
        if (pageCount >= 2 && isEdge) {
          const fp = normalizeHeaderFooterFingerprint(line);
          const count = edgeCounts.get(fp) || 0;
          if (count >= Math.min(pageCount, 3) || (count >= 2 && isLikelyRunningHeaderOrFooter(line))) {
            return false;
          }
        }
        if (/^(?:halaman|hal\.?|page)\s+\d+(?:\s*(?:dari|of|\/)\s*\d+)?$/i.test(line.trim())) {
          return false;
        }
        return true;
      });
      return {
        page: p.page,
        text: filteredLines.join('\n'),
      };
    });

    const rawText = pageTexts.map((p) => p.text).filter(Boolean).join('\n\n');
    const meaningfulChars = rawText.replace(/\s+/g, '').length;
    const isScanned = pageCount > 0 && meaningfulChars < 30;

    return {
      pageCount,
      rawText,
      pageTexts,
      isScanned,
    };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    const msg = err instanceof Error ? err.message : String(err);
    if (name === 'PasswordException' || msg.toLowerCase().includes('password')) {
      throw new Error(
        'File PDF terkunci kata sandi (encrypted). Buka proteksi kata sandi terlebih dahulu sebelum mengunggah.'
      );
    }
    throw new Error('File PDF rusak atau struktur halamannya tidak dapat dibaca.');
  }
}

// ---------------------------------------------------------------------------
// Section & Answer Key Parsing Helpers
// ---------------------------------------------------------------------------

interface ParsedAnswerKeyEntry {
  number: number;
  rawKey: string;
  explanation?: string;
  sectionType?: QuestionType;
}

interface ParsedQuestionBlock {
  declaredNumber: number;
  sectionType?: QuestionType;
  sectionLabel?: string;
  lines: string[];
}

function detectSectionTypeFromHeading(line: string): QuestionType | undefined {
  const lower = line.toLowerCase();
  if (/(?:pilihan\s+ganda\s+kompleks|pg\s+kompleks|\bpgk\b|jawaban\s+lebih\s+dari\s+satu)/i.test(lower)) {
    return 'multiple_choice_complex';
  }
  if (/(?:benar\s*(?:atau|\/|–|-)\s*salah|true\s*(?:or|\/)\s*false|\bb\s*\/\s*s\b)/i.test(lower)) {
    return 'true_false';
  }
  if (/(?:menjodohkan|pasangkan|jodohkan|matching)/i.test(lower)) {
    return 'matching';
  }
  if (/(?:isian\s+singkat|\bisian\b|melengkapi|short\s+answer|jawaban\s+singkat)/i.test(lower)) {
    return 'short_answer';
  }
  if (/(?:\buraian\b|\besai\b|\bessay\b)/i.test(lower)) {
    return 'essay';
  }
  if (/(?:pilihan\s+ganda|\bpg\b|multiple\s+choice)/i.test(lower)) {
    return 'multiple_choice';
  }
  return undefined;
}

function isSectionHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 140) return false;
  if (trimmed.includes('?') || trimmed.includes('!')) return false;
  if (/\b(?:jelaskan|uraikan|mengapa|apakah|bagaimana|sebutkan|tuliskan|hitunglah)\b/i.test(trimmed)) {
    return false;
  }

  // An Arabic-numbered line (e.g. "4. Soal dengan kata esai...") is a question unless
  // the text after the number is purely a short section title like "1. Pilihan Ganda".
  const numPrefixMatch = trimmed.match(/^\d{1,3}[\.\)]\s+(.+)$/);
  if (numPrefixMatch) {
    return /^(?:soal\s+)?(?:pilihan\s+ganda(?:\s+kompleks)?|pg\s+kompleks|benar\s*(?:atau|\/|-)\s*salah|menjodohkan|isian(?:\s+singkat)?|uraian|esai|essay)\s*:?\s*$/i.test(
      numPrefixMatch[1].trim()
    );
  }

  const hasSectionKeyword =
    /(?:bagian\s+[ivx\d]+|sub\s*bagian|pilihan\s+ganda|benar\s*(?:atau|\/|-)\s*salah|menjodohkan|isian\s+singkat|uraian|esai|essay|kunci\s+jawaban)/i.test(
      trimmed
    );
  if (!hasSectionKeyword) return false;

  if (/^(?:bagian\s+[ivx\d]+|[ivx]+\.|[a-f]\.)/i.test(trimmed)) return true;
  if (/^(?:kunci\s+jawaban|soal)\s+/i.test(trimmed)) return true;
  if (trimmed.length <= 75 && detectSectionTypeFromHeading(trimmed) !== undefined) return true;
  return false;
}

function isInstructionsHeading(line: string): boolean {
  return /^(?:petunjuk\s+(?:pengerjaan|umum|soal|pelaksanaan)|tata\s+tertib|aturan\s+pengerjaan)\b/i.test(
    line.trim()
  );
}

function isPedomanPenskoranHeading(line: string): boolean {
  return /^(?:pedoman\s+penskoran|kriteria\s+penilaian|tabel\s+penskoran|konversi\s+nilai|rekap\s+skor)\b/i.test(
    line.trim()
  );
}

function isAnswerKeyRootHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length > 120) return false;
  // Do NOT mistake an inline per-question key (e.g. "Kunci Jawaban: B" or "Kunci Jawaban: Benar")
  // for a document-level Kunci Jawaban section header.
  const colonValueMatch = trimmed.match(
    /^(?:kunci\s+jawaban|answer\s+key|kunci\s+soal)\s*[:=]\s*(.+)$/i
  );
  if (colonValueMatch) {
    const rhs = colonValueMatch[1].trim();
    if (
      !/^(?:bagian\b|sub\s*bagian\b|pilihan\s+ganda\b|benar\s*(?:atau|\/|-)\s*salah\b|menjodohkan\b|isian(?:\s+singkat)?\b|uraian\b|esai\b|essay\b)/i.test(
        rhs
      )
    ) {
      return false;
    }
  }
  return /^(?:kunci\s+jawaban(?:\s+dan\s+pembahasan)?|pembahasan\s+dan\s+kunci\s+jawaban|answer\s+key|kunci\s+soal)\b/i.test(
    trimmed
  );
}

function isInstructionProseLine(text: string): boolean {
  return /\b(?:tulislah\s+nama|bacalah\s+(?:doa|petunjuk|soal\s+dengan)|periksa\s+kembali|kerjakan\s+(?:soal|yang\s+mudah)|dahulukan\s+soal|berilah\s+tanda\s+silang|waktu\s+pengerjaan|lembar\s+jawaban|dilarang\s+(?:membuka|menyontek))\b/i.test(
    text
  );
}

function isKeyTableHeaderLine(line: string): boolean {
  const lower = line.toLowerCase().trim();
  return (
    /^(?:no\.?\s*(?:soal)?)\b/.test(lower) &&
    /\b(?:kunci|jawaban|pembahasan|keterangan|skor|bobot)\b/.test(lower)
  );
}

/**
 * Splits a single line containing multiple horizontal key entries such as:
 *   "1. C  2. B  3. B  4. B"
 *   "26. Keluarga   31. Mur"
 *   "1) A, C   2) B, D"
 * While preserving internal matching pairs like "16. 1-C, 2-A" (because 1-C uses '-' not '.').
 */
function splitHorizontalKeyEntries(line: string): Array<{ number: number; rest: string }> {
  const trimmed = line.trim();
  if (!trimmed) return [];

  // Match starts of numbered items: "1. ", "No. 21 ", "21) ", "1 = "
  const markerRegex = /(?:^|\s+)(?:No\.?\s*|Soal\s*)?(\d{1,3})\s*(?:[\.\)\=:])\s+/gi;
  const matches: Array<{ index: number; endIndex: number; number: number }> = [];

  let m: RegExpExecArray | null;
  while ((m = markerRegex.exec(trimmed)) !== null) {
    const num = parseInt(m[1], 10);
    if (num >= 1 && num <= 250) {
      matches.push({
        index: m.index,
        endIndex: markerRegex.lastIndex,
        number: num,
      });
    }
  }

  // Also support "No. 21  A, B, D" where there is no punctuation after 21, just 2+ spaces or tab
  if (matches.length === 0) {
    const noSpaceMatch = trimmed.match(/^(?:No\.?\s*|Soal\s+)(\d{1,3})(?:\t+|\s{2,}|\s+)(.+)$/i);
    if (noSpaceMatch) {
      const num = parseInt(noSpaceMatch[1], 10);
      if (num >= 1 && num <= 250) {
        return [{ number: num, rest: noSpaceMatch[2].trim() }];
      }
    }
    // Check tab/pipe table row starting with a bare number: "1 | B | ..." or "1   B"
    const tableNumMatch = trimmed.match(/^(\d{1,3})\s*(?:\||\t|\s{2,})\s*(.+)$/);
    if (tableNumMatch) {
      const num = parseInt(tableNumMatch[1], 10);
      if (num >= 1 && num <= 250) {
        return [{ number: num, rest: tableNumMatch[2].trim() }];
      }
    }
    return [];
  }

  // Guard: if a single line looks like essay prose containing an internal "1. ..." step after "Pembahasan:"
  // do not split at false internal numbers if there's only 1 entry followed by normal prose
  const entries: Array<{ number: number; rest: string }> = [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const nextStart = i + 1 < matches.length ? matches[i + 1].index : trimmed.length;
    const rest = trimmed.slice(cur.endIndex, nextStart).trim();
    if (rest) {
      entries.push({ number: cur.number, rest });
    }
  }

  // Filter out bogus consecutive splits if there are multiple numbers on a line that don't actually look sequential/paired
  // e.g. if line is a single essay key explanation containing "2. harus jujur", check if entries[0].rest was short or column-like
  if (entries.length >= 2) {
    // Valid multi-column rows typically have concise answers (< 55 chars each)
    const allConcise = entries.every((e) => e.rest.length <= 65);
    if (!allConcise) {
      // Only treat the first marker as the question number and keep full remainder as its key+explanation
      return [
        {
          number: entries[0].number,
          rest: trimmed.slice(matches[0].endIndex).trim(),
        },
      ];
    }
  }

  return entries;
}

function parseKeyAndExplanationFromRest(
  rest: string,
  sectionType?: QuestionType
): { rawKey: string; explanation?: string } {
  let clean = rest.trim();

  // Strip leading "Jawaban:" or "Kunci:" labels
  clean = clean.replace(/^(?:Kunci\s*Jawaban|Kunci|Jawaban(?:\s*Benar)?)\s*[:=]\s*/i, '').trim();

  // Handle pipe or multi-space/tab separated columns: "A, B, D   Keterangan ringkas..." or "B | Pembahasan"
  if (clean.includes('|')) {
    const parts = clean.split('|').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return {
        rawKey: parts[0],
        explanation: parts.slice(1).join(' — '),
      };
    }
  }

  // Explicit Pembahasan / Penjelasan / Keterangan marker inside the line
  const expMarker = clean.match(/\s+(?:Pembahasan|Penjelasan|Keterangan|Alasan)\s*[:=-]\s*(.+)$/i);
  if (expMarker && typeof expMarker.index === 'number') {
    const rawKey = clean.slice(0, expMarker.index).trim();
    const explanation = expMarker[1].trim();
    if (rawKey) {
      return { rawKey, explanation };
    }
  }

  // Multi-space column split in table like "A, B, D   Ketiga hal tersebut..."
  const multiSpaceCol = clean.match(/^([A-E](?:\s*[,;&]\s*[A-E])*|Benar|Salah|True|False|\d+\s*[-–>:]\s*[A-E](?:\s*[,;]\s*\d+\s*[-–>:]\s*[A-E])*)\s{2,}(.+)$/i);
  if (multiSpaceCol) {
    return {
      rawKey: multiSpaceCol[1].trim(),
      explanation: multiSpaceCol[2].trim(),
    };
  }

  // PG / PGK single-space followed by parenthetical explanation or sentence: "B (Kompas adalah...)" or "A, B, D Ketiga pernyataan tersebut..."
  if (sectionType === 'multiple_choice' || sectionType === 'multiple_choice_complex') {
    const pgParen = clean.match(/^([A-E](?:\s*(?:,|;|&|dan)\s*[A-E])*)\s*[\(\[]\s*(.+?)\s*[\)\]]$/i);
    if (pgParen) {
      return { rawKey: pgParen[1].trim(), explanation: pgParen[2].trim() };
    }
    const pgDash = clean.match(/^([A-E](?:\s*(?:,|;|&|dan)\s*[A-E])*)\s+[-–—]\s+(.+)$/i);
    if (pgDash) {
      return { rawKey: pgDash[1].trim(), explanation: pgDash[2].trim() };
    }
    const pgSpaceDesc = clean.match(/^([A-E](?:\s*(?:,|;|&|dan)\s*[A-E])*)\s+([A-Z][a-z]{2,}.+)$/);
    if (pgSpaceDesc) {
      return { rawKey: pgSpaceDesc[1].trim(), explanation: pgSpaceDesc[2].trim() };
    }
  }

  // General "B (Penjelasan...)" when sectionType is undefined
  if (!sectionType) {
    const genParen = clean.match(/^([A-E])\s*[\(\[]\s*(.+?)\s*[\)\]]$/i);
    if (genParen) {
      return { rawKey: genParen[1].trim(), explanation: genParen[2].trim() };
    }
  }

  return { rawKey: clean };
}

function parseAnswerKeyLines(keyLines: string[]): {
  bySectionAndNum: Map<string, ParsedAnswerKeyEntry>;
  byNum: Map<number, ParsedAnswerKeyEntry[]>;
  allEntriesCount: number;
} {
  const bySectionAndNum = new Map<string, ParsedAnswerKeyEntry>();
  const byNum = new Map<number, ParsedAnswerKeyEntry[]>();
  let allEntriesCount = 0;

  let currentSectionType: QuestionType | undefined;
  let activeEssayEntry: ParsedAnswerKeyEntry | null = null;
  let activeStandardEntry: ParsedAnswerKeyEntry | null = null;

  const commitEntry = (entry: ParsedAnswerKeyEntry) => {
    const secKey = `${entry.sectionType || 'any'}::${entry.number}`;
    bySectionAndNum.set(secKey, entry);
    const list = byNum.get(entry.number) || [];
    list.push(entry);
    byNum.set(entry.number, list);
    allEntriesCount++;
  };

  for (const rawLine of keyLines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (isPedomanPenskoranHeading(line)) {
      break;
    }

    if (isKeyTableHeaderLine(line)) {
      continue;
    }

    if (isAnswerKeyRootHeading(line)) {
      const maybeSec = detectSectionTypeFromHeading(line);
      if (maybeSec) currentSectionType = maybeSec;
      activeEssayEntry = null;
      activeStandardEntry = null;
      continue;
    }

    if (isSectionHeadingLine(line)) {
      const detected = detectSectionTypeFromHeading(line);
      if (detected) {
        currentSectionType = detected;
        activeEssayEntry = null;
        activeStandardEntry = null;
      }
      continue;
    }

    // Explicit Essay Key starter: "Soal No. 36:" or "No. 36:" or "36." in essay key section
    const explicitSoalNoMatch = line.match(/^(?:Soal\s+No\.?|Soal|No\.?)\s*(\d{1,3})\s*[:\.\)]\s*(.*)$/i);
    if (
      explicitSoalNoMatch &&
      (currentSectionType === 'essay' || /kunci|kriteria|jawaban|rubrik|pembahasan/i.test(explicitSoalNoMatch[2]))
    ) {
      const num = parseInt(explicitSoalNoMatch[1], 10);
      const remainder = explicitSoalNoMatch[2].trim();
      const entry: ParsedAnswerKeyEntry = {
        number: num,
        rawKey: remainder.replace(/^(?:kunci\s*jawaban|kriteria\s*jawaban)\s*[:=]?\s*/i, '').trim(),
        sectionType: currentSectionType || 'essay',
      };
      commitEntry(entry);
      if ((currentSectionType || 'essay') === 'essay') {
        activeEssayEntry = entry;
        activeStandardEntry = null;
      } else {
        activeStandardEntry = entry;
        activeEssayEntry = null;
      }
      continue;
    }

    // If inside an Essay key block, check if this line is a sub-bullet ("1. ...", "2. ...", "- ...") vs a new top-level essay number (>= activeEssayEntry.number + 1)
    if (currentSectionType === 'essay' && activeEssayEntry) {
      const topNumMatch = line.match(/^(?:Soal\s+|No\.?\s*)?(\d{1,3})[\.\)\:]\s+(.+)$/i);
      if (topNumMatch) {
        const candidateNum = parseInt(topNumMatch[1], 10);
        if (candidateNum >= activeEssayEntry.number + 1 && candidateNum <= 250) {
          const entry: ParsedAnswerKeyEntry = {
            number: candidateNum,
            rawKey: topNumMatch[2].trim(),
            sectionType: 'essay',
          };
          commitEntry(entry);
          activeEssayEntry = entry;
          continue;
        }
      }
      // Otherwise append to active essay rubric/explanation!
      activeEssayEntry.rawKey = activeEssayEntry.rawKey
        ? `${activeEssayEntry.rawKey}\n${line}`
        : line;
      continue;
    }

    // Try horizontal/table/single numbered key extraction
    const splitEntries = splitHorizontalKeyEntries(line);
    if (splitEntries.length > 0) {
      activeEssayEntry = null;
      let lastEntry: ParsedAnswerKeyEntry | null = null;
      for (const item of splitEntries) {
        const { rawKey, explanation } = parseKeyAndExplanationFromRest(item.rest, currentSectionType);
        const entry: ParsedAnswerKeyEntry = {
          number: item.number,
          rawKey,
          explanation,
          sectionType: currentSectionType,
        };
        commitEntry(entry);
        lastEntry = entry;
      }
      if (currentSectionType === 'essay' && lastEntry) {
        activeEssayEntry = lastEntry;
        activeStandardEntry = null;
      } else {
        activeStandardEntry = splitEntries.length === 1 ? lastEntry : null;
      }
      continue;
    }

    // Continuation line for Pembahasan / Keterangan belonging to previous single key
    if (activeStandardEntry) {
      if (/^(?:pembahasan|penjelasan|keterangan)\s*[:=-]/i.test(line)) {
        const cleaned = line.replace(/^(?:pembahasan|penjelasan|keterangan)\s*[:=-]\s*/i, '').trim();
        activeStandardEntry.explanation = activeStandardEntry.explanation
          ? `${activeStandardEntry.explanation} ${cleaned}`
          : cleaned;
      } else if (!/^\d+[\.\)]/.test(line)) {
        if (activeStandardEntry.explanation) {
          activeStandardEntry.explanation = `${activeStandardEntry.explanation} ${line}`.trim();
        }
      }
    }
  }

  return { bySectionAndNum, byNum, allEntriesCount };
}

function lookupMatchedAnswerKey(
  qNumber: number,
  qType: QuestionType | undefined,
  parsedKeys: ReturnType<typeof parseAnswerKeyLines>,
  hasMultipleSectionsWithResetNumbers: boolean
): ParsedAnswerKeyEntry | undefined {
  if (qType) {
    const exact = parsedKeys.bySectionAndNum.get(`${qType}::${qNumber}`);
    if (exact) return exact;
  }

  const candidates = parsedKeys.byNum.get(qNumber);
  if (!candidates || candidates.length === 0) return undefined;

  if (candidates.length === 1) {
    // When sections reset numbers (e.g. Bagian I starts at 1, Bagian II starts at 1),
    // avoid attaching a clearly different section's key to the wrong section
    const candidate = candidates[0];
    if (
      hasMultipleSectionsWithResetNumbers &&
      qType &&
      candidate.sectionType &&
      candidate.sectionType !== qType
    ) {
      return undefined;
    }
    return candidate;
  }

  if (qType) {
    const matchingSection = candidates.find((c) => c.sectionType === qType);
    if (matchingSection) return matchingSection;
  }

  return candidates[0];
}

// ---------------------------------------------------------------------------
// Key & Question Structural Helpers
// ---------------------------------------------------------------------------

function extractMultipleChoiceLetters(raw: string): string[] {
  const cleaned = raw
    .replace(/\b(?:dan|atau)\b/gi, ',')
    .replace(/[()[\]]/g, ' ');
  const tokens = cleaned
    .split(/[\s,;\/&+]+/)
    .map((t) => t.trim().toUpperCase().replace(/[^A-Z]/g, ''))
    .filter((t) => /^[A-E]$/.test(t));
  return Array.from(new Set(tokens));
}

function cleanOptionAndPromptNoise(text: string): string {
  return text
    .replace(/\[\s*\]/g, '')
    .replace(/[☐☑□■]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanShortAnswerPromptNoise(text: string): string {
  // Replace long dot leaders / underscores with tidy blank placeholder "..."
  return text
    .replace(/\.{4,}/g, ' ... ')
    .replace(/_{3,}/g, ' _____ ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMatchingPairsFromBlock(
  blockText: string,
  rawKey?: string
): { pairs: MatchingPair[]; prompt: string } {
  const lines = blockText.split('\n').map((l) => l.trim()).filter(Boolean);
  const promptLines: string[] = [];
  const leftItems: Array<{ id: string; text: string }> = [];
  const rightItems: Array<{ id: string; text: string }> = [];
  const directPairs: MatchingPair[] = [];

  for (const line of lines) {
    // Format 1: Direct inline pair "1. Akar -> Menyerap air" or "Akar = Menyerap air"
    const arrowMatch =
      !line.endsWith(':') && !line.endsWith('?')
        ? line.match(/^(?:\d+[\.\)]\s*)?(.+?)\s*(?:->|=>|↔|→)\s*(.+)$/) ||
          line.match(/^(?:\d+[\.\)]\s*)?(.+?)\s*(?:—|=)\s*(.+)$/)
        : null;
    if (arrowMatch && !/kunci|jawaban|pasangkan|jodohkan|cocokkan/i.test(arrowMatch[1])) {
      directPairs.push({
        id: String(directPairs.length + 1),
        left: arrowMatch[1].trim(),
        right: arrowMatch[2].trim(),
      });
      continue;
    }

    // Format 2: Two-column row: "1. Akar   A. Tempat fotosintesis" or "1. Akar A. Tempat fotosintesis" or "1) Akar | A) Menyerap air"
    const twoColMatch =
      line.match(/^(\d{1,2})[\.\)]\s*(.+?)(?:\s{2,}|\t|\s*\|\s*)([A-Za-z])[\.\)]\s*(.+)$/) ||
      line.match(/^(\d{1,2})[\.\)]\s*(.+?)\s+([A-H])[\.\)]\s+(.+)$/);
    if (twoColMatch) {
      leftItems.push({ id: twoColMatch[1], text: twoColMatch[2].trim() });
      rightItems.push({ id: twoColMatch[3].toUpperCase(), text: twoColMatch[4].trim() });
      continue;
    }

    // Format 3: Separate Left list ("1. ...") or Right list ("A. ...")
    const leftMatch = line.match(/^(\d{1,2})[\.\)]\s*(.+)$/);
    if (leftMatch) {
      leftItems.push({ id: leftMatch[1], text: leftMatch[2].trim() });
      continue;
    }

    const rightMatch = line.match(/^([A-Ea-e])[\.\)]\s*(.+)$/);
    if (rightMatch) {
      rightItems.push({ id: rightMatch[1].toUpperCase(), text: rightMatch[2].trim() });
      continue;
    }

    if (!/^(?:kolom\s+[ab12]|pasangkanlah|pernyataan\s+kiri|jawaban\s+kanan)\s*:?$/i.test(line)) {
      promptLines.push(line);
    }
  }

  if (directPairs.length >= 2) {
    return {
      pairs: directPairs,
      prompt: promptLines.join(' ').trim() || 'Pasangkan pernyataan di sebelah kiri dengan pasangan yang tepat di sebelah kanan!',
    };
  }

  if (leftItems.length >= 2 && rightItems.length >= 2) {
    const rightMap = new Map(rightItems.map((r) => [r.id.toUpperCase(), r.text]));
    const leftMap = new Map(leftItems.map((l) => [l.id.toUpperCase(), l.text]));
    const keyMap = new Map<string, string>();

    if (rawKey) {
      // Parse "1-C, 2-A, 3-B" or "1->C; 2->A" or "A-2, B-1"
      const pairRegex = /([A-Za-z0-9]+)\s*(?:->|[-–:=])\s*([A-Za-z0-9]+)/g;
      let pm: RegExpExecArray | null;
      while ((pm = pairRegex.exec(rawKey)) !== null) {
        const a = pm[1].toUpperCase();
        const b = pm[2].toUpperCase();
        if (leftMap.has(a) && rightMap.has(b)) {
          keyMap.set(a, b);
        } else if (leftMap.has(b) && rightMap.has(a)) {
          keyMap.set(b, a);
        }
      }
    }

    const pairs: MatchingPair[] = leftItems.map((left, idx) => {
      const mappedRightId = keyMap.get(left.id.toUpperCase());
      const resolvedRight =
        (mappedRightId ? rightMap.get(mappedRightId) : undefined) ??
        (!rawKey && rightItems[idx] ? rightItems[idx].text : '');
      return {
        id: String(idx + 1),
        left: left.text,
        right: resolvedRight,
      };
    });

    return {
      pairs,
      prompt:
        promptLines.join(' ').trim() ||
        'Jodohkan setiap pernyataan di kolom kiri dengan jawaban yang sesuai di kolom kanan!',
    };
  }

  return {
    pairs: [],
    prompt: promptLines.join(' ').trim() || blockText.trim(),
  };
}

function splitShortAnswerVariations(rawKey: string): string[] {
  const cleaned = rawKey
    .replace(/^(?:jawaban|kunci|kata\s*kunci)\s*[:=]\s*/i, '')
    .trim();
  if (!cleaned) return [];

  // Split by /, ;, |, or " atau " — avoid breaking decimals like 3,5 or thousands 1.000
  const parts = cleaned
    .split(/\s*(?:\/|;|\||\batau\b)\s*/i)
    .map((p) => p.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);

  return Array.from(new Set(parts));
}

function mapSourceTypeToAnswerSource(
  sourceType: 'pdf_text' | 'ocr' | 'word_docx' | 'word_doc' | 'drive' | 'manual',
  isInline: boolean
): AnswerSource {
  if (isInline) {
    if (sourceType === 'word_docx' || sourceType === 'word_doc') return 'word_answer_key';
    if (sourceType === 'ocr') return 'ocr_answer_key';
    if (sourceType === 'drive') return 'drive_answer_key';
    return 'pdf_inline_key';
  }
  if (sourceType === 'word_docx' || sourceType === 'word_doc') return 'word_answer_key';
  if (sourceType === 'ocr') return 'ocr_answer_key';
  if (sourceType === 'drive') return 'drive_answer_key';
  return 'pdf_answer_key';
}

// ---------------------------------------------------------------------------
// Main Parser
// ---------------------------------------------------------------------------

/**
 * Parses extracted exam text into structured Question objects across all 6 quiz types
 * with multi-format automatic answer-key matching and strict validation.
 * Never fabricates missing questions, options, or answer keys.
 */
export function parseExtractedTextToQuestions(
  rawText: string,
  sourceType: 'pdf_text' | 'ocr' | 'word_docx' | 'word_doc' | 'drive' | 'manual' = 'pdf_text',
  pageTexts?: Array<{ page: number; text: string }>
): { questions: Question[]; warnings: string[]; summary: ImportExtractionSummary } {
  const warnings: string[] = [];
  const normalized = (rawText || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();

  const emptySummary: ImportExtractionSummary = {
    totalExtracted: 0,
    byType: {
      multiple_choice: 0,
      multiple_choice_complex: 0,
      true_false: 0,
      matching: 0,
      short_answer: 0,
      essay: 0,
    },
    matchedKeysCount: 0,
    needsReviewCount: 0,
    blockingErrorCount: 0,
    duplicateNumbers: [],
    missingNumbers: [],
    hasAnswerKeySection: false,
  };

  if (!normalized) {
    return {
      questions: [],
      warnings: ['Tidak ada teks soal yang terbaca.'],
      summary: emptySummary,
    };
  }

  // 1. Separate Exam Body lines from Answer Key section(s)
  const allLines = normalized.split('\n');
  const bodyLines: string[] = [];
  const keyLines: string[] = [];
  let inKeySection = false;
  let inPedomanSection = false;
  let hasSeenQuestionsInBody = false;

  for (const rawLine of allLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (inKeySection && !inPedomanSection) keyLines.push('');
      else if (!inPedomanSection) bodyLines.push('');
      continue;
    }

    if (isAnswerKeyRootHeading(trimmed)) {
      inKeySection = true;
      inPedomanSection = false;
      keyLines.push(trimmed);
      continue;
    }

    if (isPedomanPenskoranHeading(trimmed)) {
      inPedomanSection = true;
      continue;
    }

    if (inPedomanSection) {
      continue;
    }

    if (inKeySection) {
      keyLines.push(trimmed);
      continue;
    }

    if (/^(?:soal\s+|no\.?\s*)?\d{1,3}[\.\)\:]\s+\S+/i.test(trimmed)) {
      hasSeenQuestionsInBody = true;
    }
    // Note: if document starts directly with answer keys (rare), guard via hasSeenQuestionsInBody
    if (!hasSeenQuestionsInBody && isAnswerKeyRootHeading(trimmed)) {
      inKeySection = true;
      keyLines.push(trimmed);
      continue;
    }

    bodyLines.push(trimmed);
  }

  const parsedKeys = parseAnswerKeyLines(keyLines);
  const hasAnswerKeySection = parsedKeys.allEntriesCount > 0;

  // Detect if answer keys themselves contain resetting numbers across sections
  let hasResetKeyNumbers = false;
  let maxKeyNum = 0;
  for (const lineEntries of Array.from(parsedKeys.byNum.values())) {
    if (lineEntries.length > 1) {
      hasResetKeyNumbers = true;
      break;
    }
    const n = lineEntries[0]?.number || 0;
    if (n < maxKeyNum) {
      hasResetKeyNumbers = true;
    }
    maxKeyNum = Math.max(maxKeyNum, n);
  }

  // 2. Split bodyLines into question blocks while skipping Petunjuk Umum / document preamble
  const blocks: ParsedQuestionBlock[] = [];
  let currentBlock: ParsedQuestionBlock | null = null;
  let currentSectionType: QuestionType | undefined;
  let currentSectionLabel: string | undefined;
  let inInstructionsBlock = false;
  let globalInstruction = '';
  let sectionCountWithStarts = 0;

  const qStartRegex = /^(?:Soal\s+|No\.?\s*)?(\d{1,3})[\.\)\:]\s+(.+)$/i;

  for (let lineIdx = 0; lineIdx < bodyLines.length; lineIdx++) {
    const line = bodyLines[lineIdx].trim();
    if (!line) continue;

    // Skip document metadata / title lines before questions start
    if (
      !currentBlock &&
      /^(?:mata\s+pelajaran|kelas\s*\/?\s*semester|tahun\s+(?:ajaran|pelajaran)|alokasi\s+waktu|hari\s*\/?\s*tanggal|nama\s*:\s*_{2,}|no\.?\s*absen\s*:|satuan\s+pendidikan|kurikulum|asesmen\s+sumatif)/i.test(
        line
      )
    ) {
      continue;
    }

    // Enter Petunjuk / Instructions region
    if (isInstructionsHeading(line)) {
      inInstructionsBlock = true;
      continue;
    }

    // Detect Section Heading (Bagian I: Pilihan Ganda, Bagian II: Pilihan Ganda Kompleks, etc.)
    if (isSectionHeadingLine(line)) {
      inInstructionsBlock = false;
      const detectedSec = detectSectionTypeFromHeading(line);
      if (detectedSec) {
        currentSectionType = detectedSec;
        currentSectionLabel = line;
        sectionCountWithStarts++;
      }
      if (currentBlock) {
        blocks.push(currentBlock);
        currentBlock = null;
      }
      continue;
    }

    // Single-line instruction before any block starts
    if (!currentBlock && /^(?:Petunjuk|Instruksi|Perhatikan)\s*:/i.test(line)) {
      globalInstruction = line.replace(/^(?:Petunjuk|Instruksi|Perhatikan)\s*:\s*/i, '').trim();
      continue;
    }

    const qMatch = line.match(qStartRegex);
    if (qMatch) {
      const num = parseInt(qMatch[1], 10);
      const restText = qMatch[2].trim();

      // If we are inside PETUNJUK PENGERJAAN and this line still looks like an exam rule, skip it!
      if (inInstructionsBlock) {
        if (num === 1 && blocks.length === 0 && !isInstructionProseLine(restText)) {
          // Document skipped a formal BAGIAN header and jumped straight into Q1
          inInstructionsBlock = false;
        } else if (isInstructionProseLine(restText) || blocks.length === 0) {
          continue;
        } else {
          inInstructionsBlock = false;
        }
      }

      // Guard inside a matching question block so numbered left-column sub-items ("1. Akar", "2. Daun",
      // or two-column rows "1. Akar   A. Tempat fotosintesis") do not split the parent matching question,
      // even when the matching section itself starts at Question #1!
      if (currentBlock && (currentBlock.sectionType === 'matching' || currentSectionType === 'matching')) {
        const isTwoColumnPairRow =
          /^\d{1,2}[\.\)]\s+.+?(?:\s{2,}|\t|\s*\|\s*)[A-Ha-h][\.\)]\s+/.test(line) ||
          /^\d{1,2}[\.\)]\s+.+?\s+[A-H][\.\)]\s+\S+/.test(line);
        const isArrowPairRow =
          !line.endsWith(':') &&
          !line.endsWith('?') &&
          /^\d{1,2}[\.\)]\s+.+?\s*(?:->|=>|↔|→)\s*.+$/.test(line);
        const looksLikeNewMatchingQuestionStem =
          line.endsWith(':') ||
          line.endsWith('?') ||
          /\b(?:pasangkan|jodohkan|cocokkan|hubungkan|menjodohkan)\b/i.test(restText);
        const alreadyHasSubListStart = currentBlock.lines.some((l) => /^1[\.\)]\s+\S+/.test(l.trim()));

        if (
          isTwoColumnPairRow ||
          isArrowPairRow ||
          (num <= 10 &&
            !looksLikeNewMatchingQuestionStem &&
            (currentBlock.declaredNumber > num ||
              (currentBlock.declaredNumber === num && num === 1) ||
              alreadyHasSubListStart))
        ) {
          currentBlock.lines.push(line);
          continue;
        }
      }

      if (num > 0 && num <= 250) {
        if (currentBlock) blocks.push(currentBlock);
        currentBlock = {
          declaredNumber: num,
          sectionType: currentSectionType,
          sectionLabel: currentSectionLabel,
          lines: [restText],
        };
        continue;
      }
    }

    // While inside instructions block with no active question, keep skipping prose rules
    if (inInstructionsBlock && !currentBlock) {
      continue;
    }

    if (currentBlock) {
      currentBlock.lines.push(line);
    }
  }
  if (currentBlock) blocks.push(currentBlock);

  // Secondary Petunjuk guard: if no explicit heading was caught, check if an early sequence 1..K
  // consists of exam-rule prose and then restarts at 1.
  let cleanedBlocks = blocks;
  const resetIdx = blocks.findIndex(
    (b, idx) => idx > 0 && b.declaredNumber === 1 && blocks[idx - 1].declaredNumber > 1
  );
  if (resetIdx > 0 && resetIdx <= 8) {
    const prefixBlocks = blocks.slice(0, resetIdx);
    const allLookLikeInstructions = prefixBlocks.every((b) =>
      isInstructionProseLine(b.lines.join(' '))
    );
    if (allLookLikeInstructions) {
      cleanedBlocks = blocks.slice(resetIdx);
    }
  } else if (blocks.length > 0 && sectionCountWithStarts > 0) {
    // Drop leading instruction items before first real question if they are clearly procedural rules
    let dropPrefix = 0;
    while (
      dropPrefix < cleanedBlocks.length &&
      !cleanedBlocks[dropPrefix].sectionType &&
      isInstructionProseLine(cleanedBlocks[dropPrefix].lines.join(' '))
    ) {
      dropPrefix++;
    }
    if (dropPrefix > 0) {
      cleanedBlocks = cleanedBlocks.slice(dropPrefix);
    }
  }

  // Track if question numbering itself resets across sections (e.g. Bagian I 1..10, Bagian II 1..5)
  let hasResetQuestionNumbers = false;
  for (let i = 1; i < cleanedBlocks.length; i++) {
    if (cleanedBlocks[i].declaredNumber < cleanedBlocks[i - 1].declaredNumber) {
      hasResetQuestionNumbers = true;
      break;
    }
  }
  const hasResetNumbering = hasResetKeyNumbers || hasResetQuestionNumbers;

  // 3. Transform each parsed block into a structured Question
  const questions: Question[] = [];
  const batchToken = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  cleanedBlocks.forEach((blk) => {
    const declaredNumber = blk.declaredNumber;
    let blockText = blk.lines.join('\n').trim();
    if (!blockText || blockText.length < 3) return;

    // 3a. Extract explicit point weight if mentioned
    let detectedPoints: number | undefined;
    const pointsMatch =
      blockText.match(
        /[\(\[]\s*(?:bobot|skor|nilai|poin)?\s*:?\s*(\d{1,3})\s*(?:poin|skor|nilai)\s*[\)\]]/i
      ) || blockText.match(/(?:Bobot|Skor|Poin)\s*:\s*(\d{1,3})/i);
    if (pointsMatch) {
      const parsedPts = parseInt(pointsMatch[1], 10);
      if (parsedPts > 0 && parsedPts <= 100) {
        detectedPoints = parsedPts;
      }
      blockText = blockText.replace(pointsMatch[0], '').trim();
    }

    // 3b. Extract question-specific instruction if present
    let instructions = globalInstruction || undefined;
    const instrMatch = blockText.match(/(?:Petunjuk|Instruksi|Catatan)\s*:\s*([^\n]+)/i);
    if (instrMatch) {
      instructions = instrMatch[1].trim();
      blockText = blockText.replace(instrMatch[0], '').trim();
    }

    // 3c. Extract inline answer key and optional Pembahasan from inside block
    let inlineKey: string | undefined;
    const inlineKeyMatch = blockText.match(
      /(?:^|\n)\s*(?:Kunci\s*Jawaban|Kunci|Kata\s*Kunci|Jawaban\s*Benar)\s*[:=]\s*([^\n]+)/i
    );
    if (inlineKeyMatch) {
      inlineKey = inlineKeyMatch[1].trim();
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

    // 3d. Extract options A..E (handles checkbox glyphs like "[ ] A.", "A. [ ]", and inline options "A. foo   B. bar")
    const preOptionText = blockText
      .replace(/\[\s*\]\s*([A-E])([\.\)])/gi, '$1$2')
      .replace(/[☐☑□■]\s*([A-E])([\.\)])/gi, '$1$2')
      .replace(/([A-E])([\.\)])\s*(?:\[\s*\]|[☐☑□■])\s*/gi, '$1$2 ');

    const optionSplitText = preOptionText.replace(/(?:^|\s)([A-E])([\.\)])\s+/g, '\n$1$2 ');
    const optLines = optionSplitText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const promptLines: string[] = [];
    const options: QuestionOption[] = [];
    let currentOpt: QuestionOption | null = null;

    for (const line of optLines) {
      const optMatch = line.match(/^([A-E])[\.\)]\s*(.+)$/);
      if (optMatch) {
        const optId = optMatch[1].toUpperCase();
        if (currentOpt && !options.some((o) => o.id === currentOpt!.id)) {
          options.push(currentOpt);
        }
        if (!options.some((o) => o.id === optId)) {
          currentOpt = {
            id: optId,
            text: cleanOptionAndPromptNoise(optMatch[2]),
          };
        } else {
          currentOpt = null;
        }
      } else if (currentOpt) {
        currentOpt.text = cleanOptionAndPromptNoise(`${currentOpt.text} ${line}`);
      } else {
        promptLines.push(line);
      }
    }
    if (currentOpt && !options.some((o) => o.id === currentOpt!.id)) {
      options.push(currentOpt);
    }

    const rawPromptText = promptLines.join(' ').trim();
    if (!rawPromptText) return;

    // 3e. Locate page number if pageTexts provided
    let pageFound: number | undefined;
    if (pageTexts && pageTexts.length > 0) {
      const snippet = rawPromptText.slice(0, Math.min(28, rawPromptText.length));
      const matchedPage = pageTexts.find((p) => p.text.includes(snippet));
      if (matchedPage) pageFound = matchedPage.page;
    }

    // 3f. Classify question type across all 6 types using section hints, structural cues & matched keys
    const hasCheckboxMarkers =
      /\[\s*\]|[☐☑□■]/.test(blockText) ||
      /(?:pilihlah\s+(?:2|dua|lebih\s+dari\s+satu)|lebih\s+dari\s+satu\s+jawaban|jawaban\s+benar\s+lebih\s+dari|centanglah)/i.test(
        rawPromptText
      );

    const isTrueFalseOptsOnly =
      options.length === 2 &&
      options.every((o) => /^(?:benar|salah|true|false)$/i.test(o.text.trim()));

    const hasTrueFalseCue =
      blk.sectionType === 'true_false' ||
      isTrueFalseOptsOnly ||
      /(?:\(\s*benar\s*\/\s*salah\s*\)|\(\s*b\s*\/\s*s\s*\)|benar\s+atau\s+salah|tentukan\s+benar\s+atau\s+salah|pernyataan\s+tersebut\s+benar\s+atau\s+salah)/i.test(
        rawPromptText
      );

    const hasMatchingCue =
      blk.sectionType === 'matching' ||
      /(?:\bjodohkan\b|\bpasangkan\b|\bcocokkan\b|\bhubungkan\b.*\bdengan\b|\bmenjodohkan\b)/i.test(
        rawPromptText
      );

    let preliminaryType: QuestionType | undefined = blk.sectionType;
    if (!preliminaryType) {
      if (hasTrueFalseCue && options.length <= 2) {
        preliminaryType = 'true_false';
      } else if (hasMatchingCue) {
        preliminaryType = 'matching';
      } else if (options.length >= 2) {
        preliminaryType = hasCheckboxMarkers ? 'multiple_choice_complex' : 'multiple_choice';
      }
    }

    // Lookup matched key from inline or document answer-key section
    const docKeyEntry = lookupMatchedAnswerKey(
      declaredNumber,
      preliminaryType,
      parsedKeys,
      hasResetNumbering
    );
    const effectiveRawKey = inlineKey ?? docKeyEntry?.rawKey;
    const isInlineKey = Boolean(inlineKey);
    const combinedExplanation = explicitExplanation || docKeyEntry?.explanation;

    // Refine type when section wasn't explicit
    let finalType: QuestionType;
    if (preliminaryType === 'multiple_choice' && hasCheckboxMarkers) {
      finalType = 'multiple_choice_complex';
    } else if (
      preliminaryType === 'multiple_choice' &&
      effectiveRawKey &&
      extractMultipleChoiceLetters(effectiveRawKey).length >= 2
    ) {
      finalType = 'multiple_choice_complex';
    } else if (preliminaryType) {
      finalType = preliminaryType;
    } else if (options.length >= 2) {
      finalType = hasCheckboxMarkers ? 'multiple_choice_complex' : 'multiple_choice';
    } else {
      const lowerPrompt = rawPromptText.toLowerCase();
      const hasFillBlank = /\.{3,}|_{3,}/.test(blockText);
      const looksLikeEssayVerb =
        /\b(?:jelaskan|uraikan|mengapa|bagaimana|ceritakan|tuliskan\s+pendapat|analisis|bandingkan|deskripsikan)\b/i.test(
          lowerPrompt
        );
      finalType = looksLikeEssayVerb && !hasFillBlank ? 'essay' : 'short_answer';
    }

    // 3g. Build canonical fields per question type (NEVER guessing missing keys!)
    const ordinalNumber = questions.length + 1;
    const preset = CHEST_PRESETS[(ordinalNumber - 1) % CHEST_PRESETS.length];

    let promptText = cleanOptionAndPromptNoise(rawPromptText);
    let finalOptions: QuestionOption[] | undefined =
      finalType === 'multiple_choice' || finalType === 'multiple_choice_complex'
        ? options
        : undefined;
    let correctAnswer: string | undefined;
    let correctAnswers: string[] | undefined;
    let correctBoolean: boolean | undefined;
    let acceptedAnswers: string[] | undefined;
    let keywords: string[] | undefined;
    let matchingPairs: MatchingPair[] | undefined;
    let essayRubric: string | undefined;
    let answerSource: AnswerSource = effectiveRawKey
      ? mapSourceTypeToAnswerSource(sourceType, isInlineKey)
      : 'none';
    const validationErrors: string[] = [];

    if (finalType === 'multiple_choice') {
      if (effectiveRawKey) {
        const letters = extractMultipleChoiceLetters(effectiveRawKey);
        if (letters.length === 1) {
          correctAnswer = letters[0];
        } else if (letters.length > 1) {
          // Likely mis-tagged complex question if key has multiple letters
          correctAnswer = letters[0];
          validationErrors.push(
            `Kunci jawaban mengandung lebih dari satu huruf (${letters.join(', ')}); periksa apakah jenis soal adalah Pilihan Ganda Kompleks.`
          );
        } else {
          validationErrors.push(`Format kunci "${effectiveRawKey}" tidak cocok untuk Pilihan Ganda (A/B/C/D).`);
          answerSource = 'none';
        }
      }
      if (!finalOptions || finalOptions.length < 2) {
        validationErrors.push('Opsi jawaban Pilihan Ganda (A/B/C/D) kurang dari 2.');
      }
    } else if (finalType === 'multiple_choice_complex') {
      if (effectiveRawKey) {
        const letters = extractMultipleChoiceLetters(effectiveRawKey);
        if (letters.length > 0) {
          correctAnswers = letters;
          correctAnswer = letters.join(', ');
        } else {
          validationErrors.push(
            `Format kunci "${effectiveRawKey}" tidak mengandung huruf opsi yang valid untuk Pilihan Ganda Kompleks.`
          );
          answerSource = 'none';
        }
      }
      if (!finalOptions || finalOptions.length < 2) {
        validationErrors.push('Opsi jawaban Pilihan Ganda Kompleks kurang dari 2.');
      }
    } else if (finalType === 'true_false') {
      promptText = promptText
        .replace(/\(\s*(?:Benar\s*\/\s*Salah|B\s*\/\s*S|True\s*\/\s*False)\s*\)\s*:?\s*$/i, '')
        .trim();
      finalOptions = undefined;
      if (effectiveRawKey) {
        const tfVal = normalizeTrueFalseValue(effectiveRawKey);
        if (tfVal !== null) {
          correctBoolean = tfVal;
          correctAnswer = tfVal ? 'Benar' : 'Salah';
        } else {
          validationErrors.push(
            `Kunci "${effectiveRawKey}" bukan nilai Benar/Salah yang valid.`
          );
          answerSource = 'none';
        }
      }
    } else if (finalType === 'matching') {
      finalOptions = undefined;
      const extractedMatch = extractMatchingPairsFromBlock(blockText, effectiveRawKey);
      promptText = extractedMatch.prompt;
      matchingPairs = extractedMatch.pairs;
      if (matchingPairs.length < 2) {
        validationErrors.push('Minimal harus ada 2 pasangan item kiri-kanan pada soal Menjodohkan.');
      } else if (matchingPairs.some((p) => !p.left.trim() || !p.right.trim())) {
        validationErrors.push('Sebagian pasangan Menjodohkan belum memiliki pasangan kanan dari kunci jawaban.');
      }
      if (effectiveRawKey) {
        correctAnswer = effectiveRawKey;
      }
    } else if (finalType === 'short_answer') {
      promptText = cleanShortAnswerPromptNoise(promptText);
      finalOptions = undefined;
      if (effectiveRawKey) {
        const variations = splitShortAnswerVariations(effectiveRawKey);
        if (variations.length > 0) {
          acceptedAnswers = variations;
          keywords = variations;
          correctAnswer = variations[0];
        } else {
          answerSource = 'none';
        }
      }
    } else if (finalType === 'essay') {
      finalOptions = undefined;
      if (effectiveRawKey) {
        essayRubric = effectiveRawKey;
      }
    }

    const candidateQuestion: Question = {
      id: `q-${sourceType}-${batchToken}-${ordinalNumber}`,
      number: ordinalNumber,
      questionNumber: declaredNumber,
      type: finalType,
      prompt: promptText,
      instructions,
      options: finalOptions,
      correctAnswer,
      correctAnswers,
      correctBoolean,
      acceptedAnswers,
      keywords,
      matchingPairs,
      essayRubric,
      explanation: combinedExplanation || undefined,
      points:
        detectedPoints ??
        (finalType === 'essay'
          ? 20
          : finalType === 'matching' || finalType === 'multiple_choice_complex'
          ? 15
          : finalType === 'short_answer'
          ? 15
          : 10),
      isActive: true,
      answerSource,
      validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
      sourceMeta: {
        page: pageFound,
        sourceType,
        sectionLabel: blk.sectionLabel,
        confidence: 'high',
      },
      chestPosition: preset,
      locationName: preset.name,
    };

    const qVal = validateQuestion(candidateQuestion);
    const hasObjectiveIssues =
      validationErrors.length > 0 ||
      !qVal.valid ||
      (finalType !== 'essay' && !qVal.hasKey);

    let answerStatus: AnswerStatus;
    if (finalType === 'essay') {
      answerStatus = effectiveRawKey || combinedExplanation ? 'verified' : 'manual_only';
    } else {
      answerStatus = hasObjectiveIssues ? 'needs_review' : 'verified';
    }

    const needsReview = answerStatus === 'needs_review';
    candidateQuestion.answerStatus = answerStatus;
    candidateQuestion.needsReview = needsReview;
    candidateQuestion.validationErrors =
      qVal.errors.length > 0 || validationErrors.length > 0
        ? Array.from(new Set([...validationErrors, ...qVal.errors]))
        : undefined;
    candidateQuestion.sourceMeta = {
      ...candidateQuestion.sourceMeta,
      confidence: needsReview ? 'needs_review' : 'high',
    };

    questions.push(candidateQuestion);
  });

  // 4. Detect duplicate & missing declared numbers (when not reset across sections)
  const duplicateNumbers: number[] = [];
  const missingNumbers: number[] = [];
  if (questions.length > 0 && !hasResetNumbering) {
    const counts = new Map<number, number>();
    let minNum = Infinity;
    let maxNum = 0;
    for (const q of questions) {
      const n = q.questionNumber ?? q.number;
      counts.set(n, (counts.get(n) || 0) + 1);
      minNum = Math.min(minNum, n);
      maxNum = Math.max(maxNum, n);
    }
    counts.forEach((cnt, num) => {
      if (cnt > 1) duplicateNumbers.push(num);
    });
    duplicateNumbers.sort((a, b) => a - b);

    if (minNum <= 2 && maxNum <= 200) {
      for (let i = 1; i <= maxNum; i++) {
        if (!counts.has(i)) missingNumbers.push(i);
      }
    }

    // Mark duplicate declared numbers as NEEDS_REVIEW
    if (duplicateNumbers.length > 0) {
      const dupSet = new Set(duplicateNumbers);
      for (const q of questions) {
        const n = q.questionNumber ?? q.number;
        if (dupSet.has(n)) {
          q.needsReview = true;
          q.answerStatus = 'needs_review';
          q.validationErrors = Array.from(
            new Set([
              ...(q.validationErrors || []),
              `Nomor soal #${n} terdeteksi duplikat dalam dokumen.`,
            ])
          );
          if (q.sourceMeta) q.sourceMeta.confidence = 'needs_review';
        }
      }
      warnings.push(
        `Nomor soal duplikat terdeteksi (${duplicateNumbers.join(', ')}) — ditandai Perlu Cek Guru.`
      );
    }

    if (missingNumbers.length > 0) {
      warnings.push(
        `Nomor soal tidak berurutan / terlewat dalam dokumen: ${missingNumbers.join(', ')}.`
      );
    }
  }

  // 5. Build Summary
  const byType: Record<QuestionType, number> = {
    multiple_choice: 0,
    multiple_choice_complex: 0,
    true_false: 0,
    matching: 0,
    short_answer: 0,
    essay: 0,
  };
  let matchedKeysCount = 0;
  let needsReviewCount = 0;
  let blockingErrorCount = 0;

  for (const q of questions) {
    if (ALL_QUESTION_TYPES.includes(q.type)) {
      byType[q.type]++;
    }
    const qVal = validateQuestion(q, questions);
    if (qVal.hasKey && q.type !== 'essay') {
      matchedKeysCount++;
    }
    if (q.needsReview) {
      needsReviewCount++;
    }
    if (!qVal.valid) {
      blockingErrorCount += qVal.errors.length;
    }
  }

  if (questions.length > 0) {
    if (needsReviewCount > 0) {
      warnings.push(
        `${needsReviewCount} soal memerlukan pemeriksaan guru (kunci belum cocok atau opsi kurang lengkap).`
      );
    }
  } else {
    warnings.push(
      'Teks dokumen terbaca, namun pola nomor soal (misal "1. ...", "2) ...", "Soal 1:") tidak terdeteksi otomatis.'
    );
  }

  const summary: ImportExtractionSummary = {
    totalExtracted: questions.length,
    byType,
    matchedKeysCount,
    needsReviewCount,
    blockingErrorCount,
    duplicateNumbers,
    missingNumbers,
    hasAnswerKeySection,
  };

  return { questions, warnings, summary };
}

/**
 * Full PDF upload + extraction handler
 */
export async function processPdfUpload(
  buffer: Buffer,
  fileName: string,
  mimeType?: string,
  sourceMethod: 'pdf' | 'drive' = 'pdf'
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
      sourceMethod,
      fileName,
      fileSizeBytes: buffer.length,
      pageCount: pdfResult.pageCount,
      isScanned: true,
      ocrAvailable,
      ocrUsed: false,
      recognizedCount: 0,
      needsReviewCount: 0,
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

  const parsed = parseExtractedTextToQuestions(
    pdfResult.rawText,
    sourceMethod === 'drive' ? 'drive' : 'pdf_text',
    pdfResult.pageTexts
  );

  return {
    success: true,
    sourceMethod,
    fileName,
    fileSizeBytes: buffer.length,
    pageCount: pdfResult.pageCount,
    isScanned: false,
    ocrAvailable,
    ocrUsed: false,
    recognizedCount: parsed.questions.length,
    needsReviewCount: parsed.summary.needsReviewCount,
    rawText: pdfResult.rawText,
    questions: parsed.questions,
    warnings: parsed.warnings,
    summary: parsed.summary,
    message:
      parsed.questions.length > 0
        ? `Berhasil mengekstrak ${parsed.questions.length} soal dari ${pdfResult.pageCount} halaman PDF (${parsed.summary.matchedKeysCount} kunci cocok otomatis).`
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

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: [
      {
        inlineData: {
          mimeType: 'application/pdf',
          data: buffer.toString('base64'),
        },
      },
      `Transkripkan seluruh teks soal ujian dan bagian Kunci Jawaban/Pembahasan dari dokumen PDF scan ini secara persis sesuai aslinya.
ATURAN KETAT:
1. Pertahankan judul bagian (misal BAGIAN I: PILIHAN GANDA, BAGIAN II: PILIHAN GANDA KOMPLEKS, BENAR/SALAH, MENJODOHKAN, ISIAN SINGKAT, URAIAN), nomor soal (1., 2., dst.), teks pertanyaan, opsi A/B/C/D, tanda kotak centang [ ], tabel menjodohkan, bobot poin, instruksi, kunci jawaban, dan pembahasan (jika tertulis) persis seperti di dokumen.
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
    sourceMethod: 'pdf',
    fileName,
    fileSizeBytes: buffer.length,
    pageCount: 1,
    isScanned: true,
    ocrAvailable: true,
    ocrUsed: true,
    recognizedCount: parsed.questions.length,
    needsReviewCount: parsed.summary.needsReviewCount,
    rawText: ocrText,
    questions: parsed.questions,
    warnings: parsed.warnings,
    summary: parsed.summary,
    message: `OCR selesai: ${parsed.questions.length} soal berhasil dibaca (${parsed.summary.matchedKeysCount} kunci cocok otomatis). Harap periksa kembali seluruh soal sebelum diterbitkan.`,
  };
}
