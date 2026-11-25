/**
 * Strict Shared Question & Package Validator (Frontend + Backend)
 * Type-specific validation for all 6 question types:
 *   1. multiple_choice
 *   2. multiple_choice_complex
 *   3. true_false
 *   4. matching
 *   5. short_answer
 *   6. essay (no auto key required)
 * Created by Deni Raja99
 */

import {
  ALL_QUESTION_TYPES,
  type Question,
  type QuestionPackage,
  type QuestionType,
} from '../types/game';

export interface QuestionValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  needsReview: boolean;
  hasKey: boolean;
}

export interface PackageValidationResult {
  valid: boolean;
  totalQuestions: number;
  activeCount: number;
  inactiveCount: number;
  validActiveCount: number;
  errorCount: number;
  blockingErrorCount: number;
  needsReviewCount: number;
  matchedKeysCount: number;
  byType: Record<QuestionType, number>;
  questionErrors: Record<string, string[]>;
  questionWarnings: Record<string, string[]>;
  summaryErrors: string[];
}

export function isValidQuestionImageUrl(url: string | undefined): boolean {
  if (!url) return true;
  const trimmed = url.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('/api/question-images/')) {
    return /^\/api\/question-images\/[a-zA-Z0-9._-]+$/.test(trimmed);
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeTrueFalseValue(raw?: string | boolean): boolean | null {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().toLowerCase();
  if (cleaned === 'benar' || cleaned === 'true' || cleaned === 'b' || cleaned === 'ya') {
    return true;
  }
  if (cleaned === 'salah' || cleaned === 'false' || cleaned === 's' || cleaned === 'tidak') {
    return false;
  }
  return null;
}

export function getShortAnswerAcceptedList(question: Question): string[] {
  const fromAccepted = Array.isArray(question.acceptedAnswers)
    ? question.acceptedAnswers.map((s) => s.trim()).filter(Boolean)
    : [];
  const fromKeywords = Array.isArray(question.keywords)
    ? question.keywords.map((s) => s.trim()).filter(Boolean)
    : [];
  if (fromAccepted.length > 0) return fromAccepted;
  return fromKeywords;
}

export function validateQuestion(
  question: Question,
  allQuestions?: Question[]
): QuestionValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let hasKey = false;

  const promptTrimmed = (question.prompt || '').trim();
  if (!promptTrimmed) {
    errors.push('Teks pertanyaan tidak boleh kosong.');
  } else if (promptTrimmed.length < 4) {
    errors.push('Teks pertanyaan terlalu pendek (minimal 4 karakter).');
  }

  if (!ALL_QUESTION_TYPES.includes(question.type)) {
    errors.push('Jenis soal tidak valid.');
  }

  const pts = Number(question.points);
  if (!Number.isFinite(pts) || pts < 1) {
    errors.push('Bobot poin minimal harus 1.');
  }

  if (allQuestions) {
    const dupCount = allQuestions.filter((item) => item.id === question.id).length;
    if (dupCount > 1) {
      errors.push(`ID soal duplikat terdeteksi (${question.id}).`);
    }
  }

  if (question.imageUrl && !isValidQuestionImageUrl(question.imageUrl)) {
    errors.push('URL gambar soal tidak valid (gunakan unggahan gambar atau tautan HTTPS aman).');
  }
  if (question.imageUrl && !(question.imageAlt || '').trim()) {
    warnings.push('Deskripsi gambar (alt text) sebaiknya diisi untuk aksesibilitas.');
  }

  if (question.type === 'multiple_choice') {
    const opts = Array.isArray(question.options) ? question.options : [];
    const validOpts = opts.filter((o) => o && (o.text || '').trim().length > 0);
    if (validOpts.length < 2) {
      errors.push('Soal pilihan ganda minimal harus memiliki 2 opsi jawaban yang terisi.');
    }

    const optIds = new Set<string>();
    for (const o of opts) {
      const idNorm = (o.id || '').trim().toUpperCase();
      if (!idNorm) {
        errors.push('Setiap opsi pilihan ganda harus memiliki huruf ID (A/B/C/D).');
      } else if (optIds.has(idNorm)) {
        errors.push(`Terdapat ID opsi duplikat (${idNorm}).`);
      } else {
        optIds.add(idNorm);
      }
    }

    const keyNorm = (question.correctAnswer || '').trim().toUpperCase();
    if (!keyNorm) {
      errors.push('Kunci jawaban pilihan ganda wajib dipilih (misal A/B/C/D).');
    } else {
      const matchedOpt = opts.find((o) => (o.id || '').trim().toUpperCase() === keyNorm);
      if (!matchedOpt) {
        errors.push(`Kunci jawaban "${keyNorm}" tidak merujuk ke opsi yang tersedia.`);
      } else if (!(matchedOpt.text || '').trim()) {
        errors.push(`Opsi "${keyNorm}" yang dipilih sebagai kunci jawaban masih kosong.`);
      } else {
        hasKey = true;
      }
    }
  } else if (question.type === 'multiple_choice_complex') {
    const opts = Array.isArray(question.options) ? question.options : [];
    const validOpts = opts.filter((o) => o && (o.text || '').trim().length > 0);
    if (validOpts.length < 2) {
      errors.push('Soal pilihan ganda kompleks minimal harus memiliki 2 opsi jawaban yang terisi.');
    }

    const optIds = new Set<string>();
    for (const o of opts) {
      const idNorm = (o.id || '').trim().toUpperCase();
      if (!idNorm) {
        errors.push('Setiap opsi harus memiliki huruf ID (A/B/C/D).');
      } else if (optIds.has(idNorm)) {
        errors.push(`Terdapat ID opsi duplikat (${idNorm}).`);
      } else {
        optIds.add(idNorm);
      }
    }

    const keys = Array.isArray(question.correctAnswers)
      ? Array.from(
          new Set(question.correctAnswers.map((k) => k.trim().toUpperCase()).filter(Boolean))
        )
      : question.correctAnswer
      ? Array.from(
          new Set(
            question.correctAnswer
              .split(/[,;\s]+/)
              .map((k) => k.trim().toUpperCase())
              .filter((k) => /^[A-Z]$/.test(k))
          )
        )
      : [];

    if (keys.length === 0) {
      errors.push('Pilihan ganda kompleks wajib memiliki minimal 1 kunci jawaban benar.');
    } else {
      const missingRefs: string[] = [];
      const emptyRefs: string[] = [];
      for (const k of keys) {
        const matched = opts.find((o) => (o.id || '').trim().toUpperCase() === k);
        if (!matched) missingRefs.push(k);
        else if (!(matched.text || '').trim()) emptyRefs.push(k);
      }
      if (missingRefs.length > 0) {
        errors.push(`Kunci jawaban "${missingRefs.join(', ')}" tidak merujuk ke opsi yang tersedia.`);
      }
      if (emptyRefs.length > 0) {
        errors.push(`Opsi "${emptyRefs.join(', ')}" yang dipilih sebagai kunci masih kosong.`);
      }
      if (missingRefs.length === 0 && emptyRefs.length === 0) {
        hasKey = true;
        if (keys.length < 2) {
          warnings.push('Pilihan ganda kompleks umumnya memiliki 2 atau lebih jawaban benar.');
        }
      }
    }
  } else if (question.type === 'true_false') {
    const tfVal =
      typeof question.correctBoolean === 'boolean'
        ? question.correctBoolean
        : normalizeTrueFalseValue(question.correctAnswer);
    if (tfVal === null) {
      errors.push('Soal Benar/Salah wajib memiliki kunci jawaban Benar atau Salah yang valid.');
    } else {
      hasKey = true;
    }
  } else if (question.type === 'matching') {
    const pairs = Array.isArray(question.matchingPairs) ? question.matchingPairs : [];
    if (pairs.length < 2) {
      errors.push('Soal menjodohkan minimal harus memiliki 2 pasangan pernyataan yang valid.');
    } else {
      const seenLeft = new Set<string>();
      let pairErrors = 0;
      pairs.forEach((pair, i) => {
        const leftTrim = (pair.left || '').trim();
        const rightTrim = (pair.right || '').trim();
        if (!leftTrim || !rightTrim) {
          errors.push(`Pasangan menjodohkan ke-${i + 1} belum lengkap (item kiri & kanan wajib diisi).`);
          pairErrors++;
        } else {
          const normLeft = leftTrim.toLowerCase();
          if (seenLeft.has(normLeft)) {
            errors.push(`Item kiri duplikat pada soal menjodohkan ("${leftTrim}").`);
            pairErrors++;
          }
          seenLeft.add(normLeft);
        }
      });
      if (pairErrors === 0) {
        hasKey = true;
      }
    }
  } else if (question.type === 'short_answer') {
    const accepted = getShortAnswerAcceptedList(question);
    if (accepted.length === 0) {
      errors.push('Soal isian singkat wajib memiliki minimal 1 jawaban yang diterima.');
    } else {
      hasKey = true;
    }
  } else if (question.type === 'essay') {
    // Essay never requires automatic correctAnswer for publication
    hasKey = Boolean((question.essayRubric || '').trim() || (question.explanation || '').trim());
    if (!(question.essayRubric || '').trim()) {
      warnings.push('Rubrik penilaian esai belum diisi (opsional, dinilai manual oleh guru).');
    }
  }

  if (Array.isArray(question.validationErrors) && question.validationErrors.length > 0) {
    warnings.push(...question.validationErrors);
  }

  if (question.needsReview) {
    warnings.push('Soal ditandai "Perlu Cek Guru" (NEEDS_REVIEW). Verifikasi isi dan kuncinya.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    needsReview: Boolean(question.needsReview || warnings.length > 0),
    hasKey,
  };
}

export function validatePackageForSync(pkg: QuestionPackage): PackageValidationResult {
  const questions = Array.isArray(pkg.questions) ? pkg.questions : [];
  const activeQuestions = questions.filter((q) => q.isActive !== false);
  const inactiveCount = questions.length - activeQuestions.length;

  const summaryErrors: string[] = [];
  if (!(pkg.title || '').trim()) {
    summaryErrors.push('Judul paket soal wajib diisi sebelum diterbitkan/disinkronkan.');
  }
  if (activeQuestions.length === 0) {
    summaryErrors.push('Minimal harus ada 1 soal berstatus Aktif agar dapat disinkronkan ke game 3D.');
  }

  const byType: Record<QuestionType, number> = {
    multiple_choice: 0,
    multiple_choice_complex: 0,
    true_false: 0,
    matching: 0,
    short_answer: 0,
    essay: 0,
  };

  const seenIds = new Set<string>();
  const questionErrors: Record<string, string[]> = {};
  const questionWarnings: Record<string, string[]> = {};
  let validActiveCount = 0;
  let errorCount = 0;
  let needsReviewCount = 0;
  let matchedKeysCount = 0;

  for (const q of questions) {
    if (ALL_QUESTION_TYPES.includes(q.type)) {
      byType[q.type]++;
    }

    const res = validateQuestion(q, questions);
    if (seenIds.has(q.id)) {
      res.errors.push(`ID soal duplikat: ${q.id}`);
      res.valid = false;
    }
    seenIds.add(q.id);

    if (res.hasKey && q.type !== 'essay') {
      matchedKeysCount++;
    }

    if (res.warnings.length > 0 || res.needsReview) {
      questionWarnings[q.id] = res.warnings;
      needsReviewCount++;
    }

    if (q.isActive !== false) {
      if (res.errors.length > 0) {
        questionErrors[q.id] = res.errors;
        errorCount += res.errors.length;
      } else {
        validActiveCount++;
      }
    } else if (res.errors.length > 0) {
      questionWarnings[q.id] = [
        ...(questionWarnings[q.id] || []),
        ...res.errors.map((e) => `(Nonaktif) ${e}`),
      ];
    }
  }

  const blockingErrorCount = summaryErrors.length + errorCount;

  return {
    valid: summaryErrors.length === 0 && errorCount === 0 && activeQuestions.length > 0,
    totalQuestions: questions.length,
    activeCount: activeQuestions.length,
    inactiveCount,
    validActiveCount,
    errorCount,
    blockingErrorCount,
    needsReviewCount,
    matchedKeysCount,
    byType,
    questionErrors,
    questionWarnings,
    summaryErrors,
  };
}
