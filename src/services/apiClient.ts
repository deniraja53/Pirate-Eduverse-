/**
 * Frontend REST API & Real-Time WebSocket Client for Pirate Academy 3D
 * Handles student session persistence, active quiz loading, teacher auth tokens,
 * PDF upload with real progress (<= 2 MB), OCR requests, manual grading, and WS events.
 * Created by Deni Raja99
 */

import type {
  PdfExtractionResult,
  Question,
  QuestionPackage,
  SheetsSyncStatus,
  StudentAnswer,
  StudentSession,
} from '../types/game';

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

async function parseJsonSafe<T>(res: Response): Promise<T & { success: boolean; message?: string }> {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as T & { success?: boolean; message?: string };
    return {
      ...parsed,
      success: Boolean(res.ok && parsed.success !== false),
    };
  } catch {
    return {
      success: false,
      message: `Respons server tidak valid (HTTP ${res.status}).`,
    } as T & { success: boolean; message?: string };
  }
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

export async function saveTeacherPackageApi(pkg: Partial<QuestionPackage> & { questions: Question[]; title: string }): Promise<{
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
  createNewVersion = false
): Promise<{
  success: boolean;
  package?: QuestionPackage;
  activePackageId?: string;
  sheetsSyncResult?: { success: boolean; message: string } | null;
  message: string;
}> {
  const res = await fetch(`/api/teacher/packages/${encodeURIComponent(pkgId)}/publish`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ createNewVersion }),
  });
  const data = await parseJsonSafe<{
    package?: QuestionPackage;
    activePackageId?: string;
    sheetsSyncResult?: { success: boolean; message: string } | null;
  }>(res);
  return {
    success: Boolean(res.ok && data.success),
    package: data.package,
    activePackageId: data.activePackageId,
    sheetsSyncResult: data.sheetsSyncResult,
    message: data.message || 'Gagal menerbitkan paket soal.',
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
}> {
  const res = await fetch(`/api/teacher/packages/${encodeURIComponent(pkgId)}/sync-sheets`, {
    method: 'POST',
    headers: authHeaders(),
  });
  const data = await parseJsonSafe<Record<string, unknown>>(res);
  return {
    success: Boolean(res.ok && data.success),
    message: data.message || 'Gagal menyinkronkan paket soal ke Google Sheets.',
  };
}

/**
 * Upload PDF with XMLHttpRequest for real byte-level progress and cancellation support.
 */
export function uploadPdfWithProgress(
  file: File,
  endpoint: '/api/teacher/pdf/upload' | '/api/teacher/pdf/ocr',
  onProgress: (percent: number) => void,
  onAbortRegister?: (abortFn: () => void) => void
): Promise<PdfExtractionResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', file);

    if (onAbortRegister) {
      onAbortRegister(() => xhr.abort());
    }

    xhr.open('POST', endpoint, true);
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
      try {
        const parsed = JSON.parse(xhr.responseText) as PdfExtractionResult;
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(parsed);
        } else {
          reject(new Error(parsed.message || `Server menolak file (HTTP ${xhr.status}).`));
        }
      } catch {
        reject(new Error(`Gagal membaca respons server (HTTP ${xhr.status}).`));
      }
    };

    xhr.onerror = () => {
      reject(new Error('Koneksi jaringan terputus saat mengunggah PDF.'));
    };

    xhr.onabort = () => {
      reject(new Error('Unggahan PDF dibatalkan oleh pengguna.'));
    };

    xhr.send(formData);
  });
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
  autoSyncSheets: boolean;
  activePackageId: string;
  pinConfigured: boolean;
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
