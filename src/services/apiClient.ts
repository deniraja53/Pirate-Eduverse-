/**
 * Frontend REST API & Real-Time WebSocket Client for Pirate Academy 3D
 * Handles student sessions, active quiz loading, teacher auth tokens,
 * PDF / Word / Google Drive imports, question image uploads, game sync verification,
 * manual grading, and WS events.
 * Created by Deni Raja99
 */

import type {
  DashboardActivity,
  ImportExtractionResult,
  PdfExtractionResult,
  Question,
  QuestionPackage,
  SheetsSyncStatus,
  StudentAnswer,
  StudentSession,
  SyncOperationLog,
} from '../types/game';
import type { PackageValidationResult } from '../teacher/questionValidation';

const TEACHER_TOKEN_STORAGE_KEY = 'pirate_academy_teacher_token_v4';

export function getTeacherToken(): string {
  try {
    return sessionStorage.getItem(TEACHER_TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setTeacherToken(token: string): void {
  try {
    if (token) {
      sessionStorage.setItem(TEACHER_TOKEN_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(TEACHER_TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage restriction
  }
}

type ResponseBodyKind = 'json' | 'empty' | 'html' | 'text' | 'invalid_json' | 'invalid_schema';

export interface SafeParsedResult<T> {
  ok: boolean;
  status: number;
  contentType: string;
  bodyKind: ResponseBodyKind;
  data?: T & { success?: boolean; message?: string };
  errorMessage?: string;
}

function detectHtmlResponse(rawText: string, contentType: string): boolean {
  const ctLower = contentType.toLowerCase();
  if (ctLower.includes('text/html') || ctLower.includes('application/xhtml+xml')) {
    return true;
  }
  const trimmed = rawText.trimStart().slice(0, 256).toLowerCase();
  return (
    trimmed.startsWith('<!doctype html') ||
    trimmed.startsWith('<html') ||
    trimmed.startsWith('<head') ||
    trimmed.startsWith('<body') ||
    trimmed.startsWith('<?xml')
  );
}

function logResponseDiagnostic(params: {
  stage: string;
  endpoint: string;
  status: number;
  contentType: string;
  bodyKind: ResponseBodyKind;
  bodyLength: number;
  redirected?: boolean;
}) {
  // Never log tokens, Authorization headers, URL query params, or question/student content
  console.warn('[PirateAcademy API Diagnostic]', {
    stage: params.stage,
    endpoint: params.endpoint.split('?')[0],
    httpStatus: params.status,
    contentType: params.contentType || '(tidak ada)',
    bodyKind: params.bodyKind,
    bodyLength: params.bodyLength,
    redirected: Boolean(params.redirected),
  });
}

export function inspectRawHttpResponse<T>(params: {
  stage: string;
  endpoint: string;
  status: number;
  ok: boolean;
  contentType: string;
  rawText: string;
  redirected?: boolean;
}): SafeParsedResult<T> {
  const { stage, endpoint, status, ok, contentType, rawText, redirected } = params;
  const trimmed = (rawText || '').trim();
  const isJsonContentType =
    !contentType ||
    contentType.toLowerCase().includes('application/json') ||
    contentType.toLowerCase().includes('+json');

  if (!trimmed) {
    logResponseDiagnostic({
      stage,
      endpoint,
      status,
      contentType,
      bodyKind: 'empty',
      bodyLength: rawText.length,
      redirected,
    });
    return {
      ok: false,
      status,
      contentType,
      bodyKind: 'empty',
      errorMessage: `Server mengirim respons kosong pada tahap "${stage}" (HTTP ${status}). Coba ulangi atau periksa server backend.`,
    };
  }

  if (detectHtmlResponse(trimmed, contentType)) {
    const looksLikeGoogleAuth =
      trimmed.toLowerCase().includes('accounts.google.com') ||
      trimmed.toLowerCase().includes('servicelogin');
    logResponseDiagnostic({
      stage,
      endpoint,
      status,
      contentType,
      bodyKind: 'html',
      bodyLength: rawText.length,
      redirected,
    });
    return {
      ok: false,
      status,
      contentType,
      bodyKind: 'html',
      errorMessage: looksLikeGoogleAuth
        ? `Respons server berupa halaman login Google (HTML, HTTP ${status}), bukan data JSON. Periksa izin akses layanan atau masuk ulang terlebih dahulu.`
        : `Server mengembalikan halaman HTML bukan JSON pada tahap "${stage}" (HTTP ${status}${
            redirected ? ', permintaan mengalami pengalihan/redirect' : ''
          }). Kemungkinan sesi login habis, rute API tidak cocok, atau proxy mengembalikan halaman web.`,
    };
  }

  if (!isJsonContentType && !trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    logResponseDiagnostic({
      stage,
      endpoint,
      status,
      contentType,
      bodyKind: 'text',
      bodyLength: rawText.length,
      redirected,
    });
    return {
      ok: false,
      status,
      contentType,
      bodyKind: 'text',
      errorMessage: `Server mengirim teks biasa (${contentType || 'non-JSON'}) bukan JSON pada tahap "${stage}" (HTTP ${status}).`,
    };
  }

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(trimmed);
  } catch {
    logResponseDiagnostic({
      stage,
      endpoint,
      status,
      contentType,
      bodyKind: 'invalid_json',
      bodyLength: rawText.length,
      redirected,
    });
    return {
      ok: false,
      status,
      contentType,
      bodyKind: 'invalid_json',
      errorMessage: `Format JSON dari server tidak lengkap atau rusak pada tahap "${stage}" (HTTP ${status}).`,
    };
  }

  if (!parsedUnknown || typeof parsedUnknown !== 'object' || Array.isArray(parsedUnknown)) {
    logResponseDiagnostic({
      stage,
      endpoint,
      status,
      contentType,
      bodyKind: 'invalid_schema',
      bodyLength: rawText.length,
      redirected,
    });
    return {
      ok: false,
      status,
      contentType,
      bodyKind: 'invalid_schema',
      errorMessage: `Struktur JSON respons server tidak sesuai pada tahap "${stage}" (HTTP ${status}).`,
    };
  }

  const parsed = parsedUnknown as T & { success?: boolean; message?: string };
  const logicalSuccess = Boolean(ok && parsed.success !== false);
  if (!logicalSuccess) {
    logResponseDiagnostic({
      stage,
      endpoint,
      status,
      contentType,
      bodyKind: 'json',
      bodyLength: rawText.length,
      redirected,
    });
  }

  return {
    ok: logicalSuccess,
    status,
    contentType,
    bodyKind: 'json',
    data: parsed,
    errorMessage: logicalSuccess
      ? undefined
      : parsed.message || `Permintaan gagal diproses server pada tahap "${stage}" (HTTP ${status}).`,
  };
}

async function parseJsonSafe<T>(
  res: Response,
  stage = 'Permintaan API'
): Promise<T & { success: boolean; message?: string }> {
  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();
  const inspected = inspectRawHttpResponse<T>({
    stage,
    endpoint: res.url || '(fetch)',
    status: res.status,
    ok: res.ok,
    contentType,
    rawText: text,
    redirected: res.redirected,
  });

  if (inspected.data) {
    return {
      ...inspected.data,
      success: inspected.ok,
      message: inspected.data.message || inspected.errorMessage,
    };
  }

  return {
    success: false,
    message: inspected.errorMessage || `Respons server tidak valid (HTTP ${res.status}).`,
  } as T & { success: boolean; message?: string };
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getTeacherToken();
  return {
    ...(extra || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// ========================
// PUBLIC & STUDENT APIs
// ========================

export async function fetchActiveQuiz(): Promise<{
  success: boolean;
  activePackage: QuestionPackage | null;
  message?: string;
}> {
  const res = await fetch('/api/quiz/active');
  const data = await parseJsonSafe<{ activePackage: QuestionPackage | null }>(res);
  return {
    success: Boolean(res.ok && data.success && data.activePackage),
    activePackage: data.activePackage || null,
    message: data.message,
  };
}

export async function startStudentSessionApi(
  studentName: string,
  grade: string
): Promise<{
  success: boolean;
  session?: StudentSession;
  activePackage?: QuestionPackage;
  message?: string;
}> {
  const res = await fetch('/api/sessions/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentName, grade }),
  });
  return parseJsonSafe<{ session?: StudentSession; activePackage?: QuestionPackage }>(res);
}

export async function getStudentSessionApi(sessionId: string): Promise<{
  success: boolean;
  session?: StudentSession;
  message?: string;
}> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
  return parseJsonSafe<{ session?: StudentSession }>(res, 'Memuat Sesi');
}

export async function updateSessionProgressApi(
  sessionId: string,
  pose: {
    x: number;
    y: number;
    z: number;
    rotationY: number;
    cameraYaw?: number;
    cameraPitch?: number;
  },
  options?: { keepalive?: boolean }
): Promise<{ success: boolean }> {
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pose),
      keepalive: Boolean(options?.keepalive),
    });
    return { success: res.ok };
  } catch {
    return { success: false };
  }
}

export async function submitStudentAnswerApi(
  sessionId: string,
  payload: {
    questionId: string;
    answerText: string;
    chestId?: string;
    durationSeconds?: number;
  }
): Promise<{
  success: boolean;
  alreadySubmitted?: boolean;
  answer?: StudentAnswer;
  session?: StudentSession;
  message?: string;
}> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonSafe<{
    alreadySubmitted?: boolean;
    answer?: StudentAnswer;
    session?: StudentSession;
  }>(res);
}

export async function completeStudentSessionApi(sessionId: string): Promise<{
  success: boolean;
  session?: StudentSession;
  syncResult?: { success: boolean; message: string } | null;
  message?: string;
}> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  return parseJsonSafe<{
    session?: StudentSession;
    syncResult?: { success: boolean; message: string } | null;
  }>(res);
}

export async function syncStudentSheetsApi(sessionId: string): Promise<{
  success: boolean;
  message: string;
  session?: StudentSession;
}> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/sync-sheets`, {
    method: 'POST',
  });
  const data = await parseJsonSafe<{ session?: StudentSession }>(res);
  return {
    success: Boolean(res.ok && data.success),
    message: data.message || 'Gagal sinkronisasi ke Google Sheets.',
    session: data.session,
  };
}

// ========================
// TEACHER PORTAL APIs
// ========================

export async function loginTeacherApi(pin: string): Promise<{
  success: boolean;
  token?: string;
  message: string;
}> {
  const res = await fetch('/api/teacher/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  const data = await parseJsonSafe<{ token?: string }>(res);
  if (res.ok && data.success && data.token) {
    setTeacherToken(data.token);
  }
  return {
    success: Boolean(res.ok && data.success),
    token: data.token,
    message: data.message || 'Autentikasi gagal.',
  };
}

export async function fetchTeacherOverviewApi(): Promise<{
  success: boolean;
  syncLogs: SyncOperationLog[];
  activities: DashboardActivity[];
  lastUpdatedAt?: string;
}> {
  const res = await fetch('/api/teacher/overview', {
    headers: authHeaders(),
  });
  const data = await parseJsonSafe<{
    syncLogs: SyncOperationLog[];
    activities: DashboardActivity[];
    lastUpdatedAt?: string;
  }>(res);
  return {
    success: Boolean(res.ok && data.success),
    syncLogs: data.syncLogs || [],
    activities: data.activities || [],
    lastUpdatedAt: data.lastUpdatedAt,
  };
}

export async function fetchTeacherPackagesApi(): Promise<{
  success: boolean;
  packages: QuestionPackage[];
  activePackageId: string;
  status?: number;
  message?: string;
}> {
  const res = await fetch('/api/teacher/packages', {
    headers: authHeaders(),
  });
  const data = await parseJsonSafe<{ packages: QuestionPackage[]; activePackageId: string }>(res);
  return {
    success: Boolean(res.ok && data.success),
    packages: data.packages || [],
    activePackageId: data.activePackageId || '',
    status: res.status,
    message: data.message,
  };
}

export async function saveTeacherPackageApi(
  pkg: Partial<QuestionPackage> & { questions: Question[]; title: string }
): Promise<{
  success: boolean;
  package?: QuestionPackage;
  message: string;
}> {
  const res = await fetch('/api/teacher/packages', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(pkg),
  });
  const data = await parseJsonSafe<{ package?: QuestionPackage }>(res);
  return {
    success: Boolean(res.ok && data.success),
    package: data.package,
    message: data.message || 'Gagal menyimpan paket soal.',
  };
}

export async function publishTeacherPackageApi(
  pkgId: string,
  createNewVersion = false,
  syncToSheets = true
): Promise<{
  success: boolean;
  package?: QuestionPackage;
  verifiedActivePackage?: QuestionPackage;
  activePackageId?: string;
  operationId?: string;
  durationMs?: number;
  verifiedReadBack?: boolean;
  validation?: PackageValidationResult;
  sheetsSyncResult?: { success: boolean; message: string; operationId?: string; durationMs?: number } | null;
  message: string;
}> {
  const res = await fetch(`/api/teacher/packages/${encodeURIComponent(pkgId)}/sync-game`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ createNewVersion, syncToSheets }),
  });
  const data = await parseJsonSafe<{
    package?: QuestionPackage;
    verifiedActivePackage?: QuestionPackage;
    activePackageId?: string;
    operationId?: string;
    durationMs?: number;
    verifiedReadBack?: boolean;
    validation?: PackageValidationResult;
    sheetsSyncResult?: { success: boolean; message: string; operationId?: string; durationMs?: number } | null;
  }>(res);
  return {
    success: Boolean(res.ok && data.success),
    package: data.package,
    verifiedActivePackage: data.verifiedActivePackage,
    activePackageId: data.activePackageId,
    operationId: data.operationId,
    durationMs: data.durationMs,
    verifiedReadBack: data.verifiedReadBack,
    validation: data.validation,
    sheetsSyncResult: data.sheetsSyncResult,
    message: data.message || 'Gagal menerbitkan & menyinkronkan paket soal.',
  };
}

export async function deleteTeacherPackageApi(pkgId: string): Promise<{
  success: boolean;
  packages?: QuestionPackage[];
  activePackageId?: string;
  message?: string;
}> {
  const res = await fetch(`/api/teacher/packages/${encodeURIComponent(pkgId)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  return parseJsonSafe<{ packages?: QuestionPackage[]; activePackageId?: string }>(res);
}

export async function syncPackageToSheetsApi(pkgId: string): Promise<{
  success: boolean;
  message: string;
  operationId?: string;
  durationMs?: number;
}> {
  const res = await fetch(`/api/teacher/packages/${encodeURIComponent(pkgId)}/sync-sheets`, {
    method: 'POST',
    headers: authHeaders(),
  });
  const data = await parseJsonSafe<{ operationId?: string; durationMs?: number }>(res);
  return {
    success: Boolean(res.ok && data.success),
    message: data.message || 'Gagal menyinkronkan paket soal ke Google Sheets.',
    operationId: data.operationId,
    durationMs: data.durationMs,
  };
}

/**
 * Upload question image (PNG/JPG/WEBP <= 2 MB) to server.
 */
export async function uploadQuestionImageApi(file: File): Promise<{
  success: boolean;
  imageUrl?: string;
  fileName?: string;
  sizeBytes?: number;
  message: string;
}> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/teacher/questions/image', {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });
  const data = await parseJsonSafe<{ imageUrl?: string; fileName?: string; sizeBytes?: number }>(res);
  return {
    success: Boolean(res.ok && data.success),
    imageUrl: data.imageUrl,
    fileName: data.fileName,
    sizeBytes: data.sizeBytes,
    message: data.message || 'Gagal mengunggah gambar soal.',
  };
}

export async function deleteQuestionImageApi(imageUrl: string): Promise<{
  success: boolean;
  message?: string;
}> {
  const res = await fetch('/api/teacher/questions/image', {
    method: 'DELETE',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ imageUrl }),
  });
  return parseJsonSafe(res);
}

/**
 * Upload PDF or Word (.docx/.doc) with XMLHttpRequest for real byte-level progress and cancellation.
 * Validates HTTP status, Content-Type, HTML/empty responses, JSON syntax, and extraction contract.
 */
export function uploadDocumentWithProgress(
  file: File,
  endpoint: '/api/teacher/pdf/upload' | '/api/teacher/pdf/ocr' | '/api/teacher/word/upload',
  onProgress: (percent: number) => void,
  onAbortRegister?: (abortFn: () => void) => void,
  requestId?: string
): Promise<ImportExtractionResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', file);
    if (requestId) {
      formData.append('requestId', requestId);
    }

    if (onAbortRegister) {
      onAbortRegister(() => xhr.abort());
    }

    xhr.open('POST', endpoint, true);
    xhr.setRequestHeader('Accept', 'application/json');
    if (requestId) {
      xhr.setRequestHeader('X-Request-Id', requestId);
    }
    const token = getTeacherToken();
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && evt.total > 0) {
        const pct = Math.min(95, Math.round((evt.loaded / evt.total) * 95));
        onProgress(pct);
      }
    };

    xhr.onload = () => {
      onProgress(100);
      const contentType = xhr.getResponseHeader('content-type') || '';
      const responsePath = (() => {
        try {
          return xhr.responseURL ? new URL(xhr.responseURL).pathname : endpoint;
        } catch {
          return endpoint;
        }
      })();
      const redirected = Boolean(xhr.responseURL && responsePath !== endpoint);

      const inspected = inspectRawHttpResponse<ImportExtractionResult>({
        stage: endpoint.includes('/ocr') ? 'OCR PDF' : 'Unggah & Ekstraksi Dokumen',
        endpoint,
        status: xhr.status,
        ok: xhr.status >= 200 && xhr.status < 300,
        contentType,
        rawText: xhr.responseText || '',
        redirected,
      });

      if (!inspected.ok || !inspected.data) {
        reject(
          new Error(
            inspected.errorMessage || `Gagal memproses respons server (HTTP ${xhr.status}).`
          )
        );
        return;
      }

      const payload = inspected.data;
      // Validate actual response contract (never assume HTTP 200 means extraction succeeded)
      if (
        payload.success !== true ||
        !Array.isArray(payload.questions) ||
        typeof payload.fileName !== 'string'
      ) {
        logResponseDiagnostic({
          stage: 'Validasi Kontrak Ekstraksi',
          endpoint,
          status: xhr.status,
          contentType,
          bodyKind: 'invalid_schema',
          bodyLength: (xhr.responseText || '').length,
          redirected,
        });
        reject(
          new Error(
            payload.message ||
              `Respons ekstraksi dokumen dari server tidak sesuai format yang diharapkan (HTTP ${xhr.status}).`
          )
        );
        return;
      }

      resolve(payload);
    };

    xhr.onerror = () => {
      logResponseDiagnostic({
        stage: 'Koneksi Unggah Dokumen',
        endpoint,
        status: xhr.status || 0,
        contentType: '',
        bodyKind: 'empty',
        bodyLength: 0,
      });
      reject(new Error('Koneksi jaringan terputus saat mengunggah dokumen.'));
    };

    xhr.onabort = () => {
      reject(new Error('Unggahan dokumen dibatalkan oleh pengguna.'));
    };

    xhr.send(formData);
  });
}

// Keep legacy export name alias
export const uploadPdfWithProgress = uploadDocumentWithProgress as (
  file: File,
  endpoint: '/api/teacher/pdf/upload' | '/api/teacher/pdf/ocr',
  onProgress: (percent: number) => void,
  onAbortRegister?: (abortFn: () => void) => void
) => Promise<PdfExtractionResult>;

export async function importFromGoogleDriveApi(params: {
  fileIdOrUrl: string;
  driveAccessToken?: string;
}): Promise<ImportExtractionResult> {
  const res = await fetch('/api/teacher/drive/import', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(params),
  });
  const data = await parseJsonSafe<ImportExtractionResult>(res);
  if (!res.ok || !data.success) {
    throw new Error(data.message || `Gagal mengimpor file dari Google Drive (HTTP ${res.status}).`);
  }
  return data;
}

export async function fetchTeacherSessionsApi(): Promise<{
  success: boolean;
  sessions: StudentSession[];
  lastUpdatedAt?: string;
  status?: number;
}> {
  const res = await fetch('/api/teacher/sessions', {
    headers: authHeaders(),
  });
  const data = await parseJsonSafe<{ sessions: StudentSession[]; lastUpdatedAt?: string }>(res);
  return {
    success: Boolean(res.ok && data.success),
    sessions: data.sessions || [],
    lastUpdatedAt: data.lastUpdatedAt,
    status: res.status,
  };
}

export async function gradeStudentAnswerApi(
  sessionId: string,
  payload: {
    questionId: string;
    scoreAwarded: number;
    teacherFeedback: string;
    gradedBy?: string;
  }
): Promise<{
  success: boolean;
  session?: StudentSession;
  message?: string;
}> {
  const res = await fetch(`/api/teacher/sessions/${encodeURIComponent(sessionId)}/grade`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return parseJsonSafe<{ session?: StudentSession }>(res);
}

export async function retrySessionSheetsSyncApi(sessionId: string): Promise<{
  success: boolean;
  message: string;
  session?: StudentSession;
}> {
  const res = await fetch(`/api/teacher/sessions/${encodeURIComponent(sessionId)}/retry-sync`, {
    method: 'POST',
    headers: authHeaders(),
  });
  const data = await parseJsonSafe<{ session?: StudentSession }>(res);
  return {
    success: Boolean(res.ok && data.success),
    message: data.message || 'Gagal menyinkronkan ulang sesi.',
    session: data.session,
  };
}

export interface TeacherSettingsDto {
  googleSheetsWebAppUrl: string;
  spreadsheetIdOrUrl: string;
  maskedSpreadsheetId: string;
  spreadsheetOpenUrl: string;
  autoSyncSheets: boolean;
  activePackageId: string;
  pinConfigured: boolean;
  sheetsSharedSecretConfigured: boolean;
  sheetsLastSyncAt: string;
  sheetsLastError: string;
}

export async function fetchTeacherSettingsApi(): Promise<{
  success: boolean;
  settings?: TeacherSettingsDto;
}> {
  const res = await fetch('/api/teacher/settings', {
    headers: authHeaders(),
  });
  return parseJsonSafe<{ settings?: TeacherSettingsDto }>(res);
}

export async function updateTeacherSettingsApi(payload: {
  googleSheetsWebAppUrl?: string;
  spreadsheetIdOrUrl?: string;
  sheetsSharedSecret?: string;
  clearSharedSecret?: boolean;
  autoSyncSheets?: boolean;
  activePackageId?: string;
  newPin?: string;
}): Promise<{
  success: boolean;
  settings?: TeacherSettingsDto;
  message: string;
}> {
  const res = await fetch('/api/teacher/settings', {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  const data = await parseJsonSafe<{ settings?: TeacherSettingsDto }>(res);
  return {
    success: Boolean(res.ok && data.success),
    settings: data.settings,
    message: data.message || 'Gagal menyimpan pengaturan.',
  };
}

export async function testSheetsConnectionBackendApi(url: string): Promise<{
  success: boolean;
  message: string;
  data?: unknown;
}> {
  const res = await fetch('/api/teacher/sheets/test', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ url }),
  });
  const data = await parseJsonSafe<{ data?: unknown }>(res);
  return {
    success: Boolean(res.ok && data.success),
    message: data.message || 'Pengujian koneksi gagal.',
    data: data.data,
  };
}

// ========================
// REAL-TIME WEBSOCKET
// ========================

export type RealtimeWsEvent =
  | { type: 'ws:connected'; payload: { serverTime: string }; timestamp?: string }
  | { type: 'quiz:published'; payload: QuestionPackage; timestamp?: string }
  | { type: 'session:updated'; payload: StudentSession; timestamp?: string }
  | {
      type: 'sheets:sync_status';
      payload: {
        sessionId: string;
        status: SheetsSyncStatus;
        syncedToSheets: boolean;
        lastSyncedAt?: string;
        error?: string;
      };
      timestamp?: string;
    };

export function connectRealtimeWs(onEvent: (event: RealtimeWsEvent) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const connect = () => {
    if (disposed) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      ws = new WebSocket(wsUrl);
      ws.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(String(evt.data)) as RealtimeWsEvent;
          onEvent(parsed);
        } catch {
          // ignore malformed WS frame
        }
      };
      ws.onclose = () => {
        if (!disposed) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };
      ws.onerror = () => {
        ws?.close();
      };
    } catch {
      if (!disposed) {
        reconnectTimer = setTimeout(connect, 4000);
      }
    }
  };

  connect();

  return () => {
    disposed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
  };
}
