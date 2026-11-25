/**
 * Backend Google Sheets Synchronization Service (V11 + V4 Backward Compatible)
 * - Sanitizes all text cells against Spreadsheet Formula Injection (=, +, -, @, tab, cr)
 * - Never sends raw image blobs/base64; sends safe relative/public Gambar_URL only
 * - Records every sync attempt into LogSinkronisasi (local & Sheets)
 * - Never claims success if HTTP request fails, times out, or returns invalid JSON
 * Created by Deni Raja99
 */

import type { QuestionPackage, SheetsSyncStatus, StudentSession } from '../src/types/game.ts';
import { loadDatabase, recordDashboardActivity, recordSyncLog, saveDatabase } from './db.ts';

export type SyncStatusListener = (event: {
  sessionId: string;
  status: SheetsSyncStatus;
  syncedToSheets: boolean;
  lastSyncedAt?: string;
  error?: string;
}) => void;

const RETRY_DELAYS_MS = [2000, 5000, 12000];
const activeTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Neutralize spreadsheet formula injection characters (=, +, -, @, \t, \r).
 */
export function sanitizeSheetCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (!str) return '';
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

export function extractSpreadsheetId(input?: string): string {
  const trimmed = (input || '').trim();
  if (!trimmed) return '';
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{15,120})/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9_-]{15,120}$/.test(trimmed)) return trimmed;
  return '';
}

export function maskSpreadsheetId(input?: string): string {
  const id = extractSpreadsheetId(input);
  if (!id) return '';
  if (id.length <= 10) return id;
  return `${id.slice(0, 5)}...${id.slice(-5)}`;
}

export function isValidAppsScriptUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'script.google.com' || parsed.hostname === 'script.googleusercontent.com')
    );
  } catch {
    return false;
  }
}

function resolvePublicImageUrl(imageUrl?: string): string {
  if (!imageUrl) return '';
  const trimmed = imageUrl.trim();
  if (!trimmed) return '';
  // Never dump base64 blobs into Google Sheets cells
  if (trimmed.startsWith('data:')) return '';
  if (trimmed.startsWith('/api/question-images/')) {
    const appUrl = (process.env.APP_URL || '').trim().replace(/\/$/, '');
    return appUrl ? `${appUrl}${trimmed}` : trimmed;
  }
  return trimmed;
}

export function buildSiswaPayload(session: StudentSession) {
  return {
    studentId: sanitizeSheetCell(session.student.studentId || session.sessionId),
    nama: sanitizeSheetCell(session.student.name),
    kelas: sanitizeSheetCell(session.student.grade),
    status: session.isCompleted ? 'Selesai' : 'Aktif',
    updatedAt: session.updatedAt || new Date().toISOString(),
  };
}

function formatQuestionOptionsJsonForSheet(q: QuestionPackage['questions'][number]): string {
  if (q.type === 'matching') {
    return JSON.stringify(
      (q.matchingPairs || []).map((p) => ({
        id: sanitizeSheetCell(p.id),
        left: sanitizeSheetCell(p.left),
        right: sanitizeSheetCell(p.right),
      }))
    );
  }
  if (q.type === 'true_false') {
    return JSON.stringify([
      { id: 'Benar', text: 'Benar' },
      { id: 'Salah', text: 'Salah' },
    ]);
  }
  return JSON.stringify(
    (q.options || []).map((o) => ({
      id: sanitizeSheetCell(o.id),
      text: sanitizeSheetCell(o.text),
    }))
  );
}

function formatQuestionChoicesForSheet(q: QuestionPackage['questions'][number]): string {
  if (q.type === 'matching' && Array.isArray(q.matchingPairs) && q.matchingPairs.length > 0) {
    return sanitizeSheetCell(q.matchingPairs.map((p, i) => `${i + 1}. ${p.left} <-> ${p.right}`).join(' | '));
  }
  if (q.type === 'true_false') {
    return 'Benar | Salah';
  }
  if (q.options && q.options.length > 0) {
    return sanitizeSheetCell(q.options.map((o) => `${o.id}. ${o.text}`).join(' | '));
  }
  return '-';
}

function formatQuestionKeyForSheet(q: QuestionPackage['questions'][number]): string {
  if (q.type === 'multiple_choice') {
    return sanitizeSheetCell(q.correctAnswer || 'Belum ditentukan');
  }
  if (q.type === 'multiple_choice_complex') {
    const list = Array.isArray(q.correctAnswers) && q.correctAnswers.length > 0
      ? q.correctAnswers
      : q.correctAnswer
      ? [q.correctAnswer]
      : [];
    return sanitizeSheetCell(list.length > 0 ? list.join(', ') : 'Belum ditentukan');
  }
  if (q.type === 'true_false') {
    if (typeof q.correctBoolean === 'boolean') {
      return q.correctBoolean ? 'Benar' : 'Salah';
    }
    return sanitizeSheetCell(q.correctAnswer || 'Belum ditentukan');
  }
  if (q.type === 'matching') {
    if (Array.isArray(q.matchingPairs) && q.matchingPairs.length > 0) {
      return sanitizeSheetCell(q.matchingPairs.map((p) => `${p.left} -> ${p.right}`).join(' | '));
    }
    return sanitizeSheetCell(q.correctAnswer || 'Belum ditentukan');
  }
  if (q.type === 'short_answer') {
    const list = Array.isArray(q.acceptedAnswers) && q.acceptedAnswers.length > 0
      ? q.acceptedAnswers
      : q.keywords || [];
    return sanitizeSheetCell(list.length > 0 ? list.join(' / ') : 'Belum ditentukan');
  }
  return sanitizeSheetCell(q.essayRubric || 'Dinilai Manual oleh Guru');
}

function formatStudentAnswerForSheet(answerText: string, questionType?: string): string {
  const trimmed = (answerText || '').trim();
  if (!trimmed) return '';
  if (questionType === 'matching' || (trimmed.startsWith('{') || trimmed.startsWith('['))) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return sanitizeSheetCell(parsed.map((v) => String(v)).join(', '));
      }
      if (parsed && typeof parsed === 'object') {
        return sanitizeSheetCell(
          Object.entries(parsed as Record<string, unknown>)
            .map(([k, v]) => `${k} -> ${String(v)}`)
            .join(' | ')
        );
      }
    } catch {
      // fall through
    }
  }
  return sanitizeSheetCell(trimmed);
}

export function buildBankSoalPayload(pkg: QuestionPackage, operationId?: string) {
  const activeQuestions = (pkg.questions || []).filter((q) => q.isActive !== false);
  const now = new Date().toISOString();

  return {
    quizId: sanitizeSheetCell(pkg.id),
    title: sanitizeSheetCell(pkg.title),
    gradeLevel: sanitizeSheetCell(pkg.gradeLevel),
    versi: pkg.version || 1,
    statusPublikasi: pkg.isPublished ? 'Aktif' : 'Draf',
    operationLog: operationId
      ? {
          idOperasi: operationId,
          jenisOperasi: 'Sinkronisasi BankSoal',
          status: 'Sukses',
          jumlahData: activeQuestions.length,
          waktuMulai: now,
          waktuSelesai: now,
          pesan: sanitizeSheetCell(`Sinkronisasi ${activeQuestions.length} soal aktif (${pkg.title})`),
        }
      : undefined,
    questions: activeQuestions.map((q, idx) => ({
      quizId: sanitizeSheetCell(pkg.id),
      questionId: sanitizeSheetCell(q.id),
      nomorSoal: idx + 1,
      jenisSoal: sanitizeSheetCell(q.type),
      teksPertanyaan: sanitizeSheetCell(q.prompt),
      opsiJson: formatQuestionOptionsJsonForSheet(q),
      pilihanJawaban: formatQuestionChoicesForSheet(q),
      kunciJawaban: formatQuestionKeyForSheet(q),
      pembahasan: sanitizeSheetCell(q.explanation || q.correctExplanation || ''),
      gambarUrl: sanitizeSheetCell(resolvePublicImageUrl(q.imageUrl)),
      bobotNilai: Number(q.points) || 10,
      statusPublikasi: pkg.isPublished ? 'Aktif' : 'Draf',
      versi: pkg.version || 1,
      updatedAt: q.updatedAt || pkg.updatedAt || now,
    })),
  };
}

export function buildHasilAndRekapPayload(session: StudentSession) {
  const answersArray = Object.values(session.answers || {});
  const startMs = new Date(session.startTime).getTime();

  const hasilRows = answersArray.map((ans) => {
    const ansMs = ans.answeredAt ? new Date(ans.answeredAt).getTime() : Date.now();
    const durationSec =
      typeof ans.durationSeconds === 'number'
        ? ans.durationSeconds
        : Math.max(0, Math.round((ansMs - startMs) / 1000));

    return {
      resultId: sanitizeSheetCell(ans.resultId || `${session.sessionId}::${ans.questionId}`),
      timestamp: ans.answeredAt || new Date().toISOString(),
      studentId: sanitizeSheetCell(session.student.studentId || session.sessionId),
      namaSiswa: sanitizeSheetCell(session.student.name),
      kelas: sanitizeSheetCell(session.student.grade),
      quizId: sanitizeSheetCell(ans.quizId || session.packageId),
      questionId: sanitizeSheetCell(ans.questionId),
      teksPertanyaan: sanitizeSheetCell(ans.questionPrompt || `Soal #${ans.questionNumber}`),
      jawabanSiswa: formatStudentAnswerForSheet(ans.answerText, ans.questionType),
      kunciJawaban: sanitizeSheetCell(ans.correctAnswerSnapshot || 'Menunggu / Manual'),
      nilai: Number(ans.scoreAwarded) || 0,
      nilaiMaksimum: Number(ans.maxPoints) || 0,
      statusPenilaian:
        ans.gradingStatus === 'pending_review' && !ans.isGradedManually
          ? 'Menunggu Penilaian'
          : ans.isGradedManually
          ? 'Dinilai Manual'
          : ans.isCorrect
          ? 'Benar'
          : 'Salah',
      durasiPengerjaan: `${durationSec} detik`,
    };
  });

  const pendingCount = answersArray.filter(
    (a) => a.gradingStatus === 'pending_review' && !a.isGradedManually
  ).length;

  return {
    sessionId: sanitizeSheetCell(session.sessionId),
    siswa: buildSiswaPayload(session),
    hasilRows,
    rekap: {
      sessionId: sanitizeSheetCell(session.sessionId),
      studentId: sanitizeSheetCell(session.student.studentId || session.sessionId),
      namaSiswa: sanitizeSheetCell(session.student.name),
      kelas: sanitizeSheetCell(session.student.grade),
      quizId: sanitizeSheetCell(session.packageId),
      judulKuis: sanitizeSheetCell(session.packageTitle),
      soalSelesai: session.chestsCompleted.length,
      totalNilai: Number(session.totalScore) || 0,
      nilaiMaksimum: Number(session.maxPossibleScore) || 0,
      persentase: Number(session.percentageScore) || 0,
      statusPengerjaan: session.isCompleted ? 'Selesai' : 'Berjalan',
      pendingCount,
      updatedAt: new Date().toISOString(),
    },
  };
}

function parseAppsScriptHttpResponse(params: {
  stage: string;
  response: Response;
  rawText: string;
}): { success: boolean; message: string; data?: unknown } {
  const { stage, response, rawText } = params;
  const contentType = response.headers.get('content-type') || '';
  const trimmed = (rawText || '').trim();
  const isHtml =
    contentType.toLowerCase().includes('text/html') ||
    trimmed.toLowerCase().startsWith('<!doctype') ||
    trimmed.toLowerCase().startsWith('<html');

  const logDiag = (bodyKind: string) => {
    console.warn('[PirateAcademy Sheets Diagnostic]', {
      stage,
      httpStatus: response.status,
      contentType: contentType || '(tidak ada)',
      bodyKind,
      bodyLength: rawText.length,
      redirected: response.redirected,
    });
  };

  if (!response.ok) {
    logDiag('http_error');
    return {
      success: false,
      message: `Web App Google Apps Script merespons HTTP ${response.status}. Pastikan akses deployment diatur ke "Siapa saja (Anyone)".`,
    };
  }

  if (!trimmed) {
    logDiag('empty');
    return {
      success: false,
      message: `Google Apps Script mengembalikan respons kosong (HTTP ${response.status}). Periksa fungsi doGet/doPost di Code.gs.`,
    };
  }

  if (isHtml) {
    logDiag('html');
    const isGoogleSignIn =
      trimmed.toLowerCase().includes('accounts.google.com') ||
      trimmed.toLowerCase().includes('servicelogin');
    return {
      success: false,
      message: isGoogleSignIn
        ? `Google Apps Script mengarahkan ke halaman login Google (HTML, HTTP ${response.status}). Pastikan URL diakhiri "/exec" dan izin Web App diatur ke "Siapa saja (Anyone)".`
        : `Google Apps Script mengembalikan halaman HTML bukan JSON (HTTP ${response.status}). Pastikan kode Code.gs terbaru sudah disimpan dan dideploy ulang.`,
    };
  }

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(trimmed);
  } catch {
    logDiag('invalid_json');
    return {
      success: false,
      message: `Respons Google Apps Script bukan JSON valid (HTTP ${response.status}). Periksa implementasi jsonResponse() di Code.gs.`,
    };
  }

  if (!parsedUnknown || typeof parsedUnknown !== 'object' || Array.isArray(parsedUnknown)) {
    logDiag('invalid_schema');
    return {
      success: false,
      message: `Struktur JSON dari Google Apps Script tidak sesuai (HTTP ${response.status}).`,
    };
  }

  const parsed = parsedUnknown as { success?: boolean; status?: string; message?: string };
  if (parsed.success === false || parsed.status === 'error') {
    logDiag('json_error');
    return {
      success: false,
      message: parsed.message || 'Google Apps Script melaporkan kegagalan pemrosesan.',
    };
  }

  return {
    success: true,
    message: parsed.message || 'Data berhasil tersinkron ke Google Sheets.',
    data: parsed,
  };
}

async function postToAppsScript(
  webAppUrl: string,
  body: Record<string, unknown>
): Promise<{ success: boolean; message: string; data?: unknown }> {
  if (!webAppUrl || !isValidAppsScriptUrl(webAppUrl)) {
    return {
      success: false,
      message: 'URL Google Apps Script belum dikonfigurasi atau tidak valid (harus https://script.google.com/...).',
    };
  }

  const db = loadDatabase();
  const payloadWithSecret =
    db.settings.sheetsSharedSecret
      ? { ...body, syncToken: db.settings.sheetsSharedSecret }
      : body;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 14000);

  try {
    const response = await fetch(webAppUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
        Accept: 'application/json',
      },
      body: JSON.stringify(payloadWithSecret),
      redirect: 'follow',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const text = await response.text();
    return parseAppsScriptHttpResponse({
      stage: String(body.action || 'doPost'),
      response,
      rawText: text,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `Gagal menghubungi Google Sheets: ${msg}`,
    };
  }
}

export async function testAppsScriptConnection(
  webAppUrl: string
): Promise<{ success: boolean; message: string; data?: unknown }> {
  if (!webAppUrl || !isValidAppsScriptUrl(webAppUrl)) {
    return {
      success: false,
      message:
        'Format URL tidak valid. Harus dimulai dengan https://script.google.com/macros/s/.../exec',
    };
  }

  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const opId = `op-test-${Date.now()}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const db = loadDatabase();
    const tokenParam = db.settings.sheetsSharedSecret
      ? `&syncToken=${encodeURIComponent(db.settings.sheetsSharedSecret)}`
      : '';
    const testUrl = `${webAppUrl}${webAppUrl.includes('?') ? '&' : '?'}action=status${tokenParam}`;
    const res = await fetch(testUrl, {
      headers: { Accept: 'application/json' },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - startMs;
    const rawText = await res.text();
    const inspected = parseAppsScriptHttpResponse({
      stage: 'testConnection',
      response: res,
      rawText,
    });

    if (inspected.success) {
      db.settings.sheetsLastError = undefined;
    } else {
      db.settings.sheetsLastError = inspected.message;
    }
    saveDatabase();

    recordSyncLog({
      id: opId,
      operationType: 'test_sheets_connection',
      target: 'google_sheets',
      status: inspected.success ? 'success' : 'failed',
      itemCount: 0,
      startedAt,
      finishedAt,
      durationMs,
      message: inspected.message,
    });
    recordDashboardActivity({
      category: 'sheets',
      status: inspected.success ? 'success' : 'error',
      title: inspected.success ? 'Uji Koneksi Google Sheets Berhasil' : 'Uji Koneksi Google Sheets Gagal',
      detail: inspected.message,
    });

    return inspected;
  } catch (err) {
    clearTimeout(timeoutId);
    const msg = `Gagal menghubungi Web App: ${err instanceof Error ? err.message : String(err)}`;
    const db = loadDatabase();
    db.settings.sheetsLastError = msg;
    saveDatabase();
    recordSyncLog({
      id: opId,
      operationType: 'test_sheets_connection',
      target: 'google_sheets',
      status: 'failed',
      itemCount: 0,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
      message: msg,
    });
    return { success: false, message: msg };
  }
}

export async function syncPackageToSheets(
  pkg: QuestionPackage,
  existingOpId?: string
): Promise<{ success: boolean; message: string; operationId: string; durationMs: number }> {
  const db = loadDatabase();
  const url = db.settings.googleSheetsWebAppUrl;
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const opId = existingOpId || `op-sheets-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const activeCount = (pkg.questions || []).filter((q) => q.isActive !== false).length;

  if (!url) {
    const msg = 'URL Google Apps Script belum disetel di Pengaturan Integrasi.';
    return { success: false, message: msg, operationId: opId, durationMs: Date.now() - startMs };
  }

  const res = await postToAppsScript(url, {
    action: 'syncPackage',
    payload: buildBankSoalPayload(pkg, opId),
  });

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;

  if (res.success) {
    db.settings.sheetsLastSyncAt = finishedAt;
    db.settings.sheetsLastError = undefined;
  } else {
    db.settings.sheetsLastError = res.message;
  }
  saveDatabase();

  recordSyncLog({
    id: opId,
    operationType: 'sync_sheets_bank',
    target: 'google_sheets',
    packageId: pkg.id,
    packageTitle: pkg.title,
    status: res.success ? 'success' : 'failed',
    itemCount: activeCount,
    startedAt,
    finishedAt,
    durationMs,
    message: res.message,
  });

  recordDashboardActivity({
    category: 'sheets',
    status: res.success ? 'success' : 'error',
    title: res.success ? 'Sinkronisasi BankSoal ke Sheets' : 'Gagal Sinkron BankSoal ke Sheets',
    detail: `${pkg.title}: ${res.message}`,
  });

  return {
    success: res.success,
    message: res.message,
    operationId: opId,
    durationMs,
  };
}

export async function syncSessionNow(
  sessionId: string,
  onStatus?: SyncStatusListener,
  attempt: number = 0
): Promise<{ success: boolean; message: string }> {
  const db = loadDatabase();
  const session = db.sessions.find((s) => s.sessionId === sessionId);
  if (!session) {
    return { success: false, message: 'Sesi siswa tidak ditemukan.' };
  }

  const url = db.settings.googleSheetsWebAppUrl;
  if (!url) {
    session.syncedToSheets = false;
    session.sheetsSyncStatus = 'idle';
    session.sheetsSyncError = 'URL Google Apps Script belum disetel di Portal Guru.';
    saveDatabase();
    return { success: false, message: session.sheetsSyncError };
  }

  const existingTimer = activeTimers.get(sessionId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    activeTimers.delete(sessionId);
  }

  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const opId = `op-ses-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;

  session.sheetsSyncStatus = 'syncing';
  session.sheetsSyncError = undefined;
  saveDatabase();
  onStatus?.({
    sessionId,
    status: 'syncing',
    syncedToSheets: false,
  });

  const payload = buildHasilAndRekapPayload(session);
  const res = await postToAppsScript(url, {
    action: 'saveSessionV4',
    payload,
  });

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;

  if (res.success) {
    session.syncedToSheets = true;
    session.sheetsSyncStatus = 'synced';
    session.sheetsSyncError = undefined;
    session.lastSyncedAt = finishedAt;
    db.settings.sheetsLastSyncAt = finishedAt;
    db.settings.sheetsLastError = undefined;
    saveDatabase();

    recordSyncLog({
      id: opId,
      operationType: 'sync_sheets_session',
      target: 'google_sheets',
      packageId: session.packageId,
      packageTitle: session.packageTitle,
      status: 'success',
      itemCount: Object.keys(session.answers || {}).length,
      startedAt,
      finishedAt,
      durationMs,
      message: `${session.student.name}: ${res.message}`,
    });

    onStatus?.({
      sessionId,
      status: 'synced',
      syncedToSheets: true,
      lastSyncedAt: finishedAt,
    });
    return res;
  }

  session.syncedToSheets = false;
  session.sheetsSyncStatus = 'failed';
  session.sheetsSyncError = res.message;
  db.settings.sheetsLastError = res.message;
  saveDatabase();

  recordSyncLog({
    id: opId,
    operationType: 'sync_sheets_session',
    target: 'google_sheets',
    packageId: session.packageId,
    packageTitle: session.packageTitle,
    status: 'failed',
    itemCount: Object.keys(session.answers || {}).length,
    startedAt,
    finishedAt,
    durationMs,
    message: `${session.student.name}: ${res.message}`,
  });

  onStatus?.({
    sessionId,
    status: 'failed',
    syncedToSheets: false,
    error: res.message,
  });

  if (attempt < RETRY_DELAYS_MS.length) {
    const delayMs = RETRY_DELAYS_MS[attempt];
    const timer = setTimeout(() => {
      activeTimers.delete(sessionId);
      void syncSessionNow(sessionId, onStatus, attempt + 1);
    }, delayMs);
    activeTimers.set(sessionId, timer);
  }

  return res;
}
