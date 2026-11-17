/**
 * Backend Google Sheets Synchronization Service with Exponential Backoff Retry
 * Syncs Siswa, BankSoal, Hasil, and Rekap sheets via Google Apps Script Web App URL.
 * Never claims sync succeeded if request failed or was rejected.
 * Created by Deni Raja99
 */

import type { QuestionPackage, SheetsSyncStatus, StudentSession } from '../src/types/game.ts';
import { loadDatabase, saveDatabase } from './db.ts';

export type SyncStatusListener = (event: {
  sessionId: string;
  status: SheetsSyncStatus;
  syncedToSheets: boolean;
  lastSyncedAt?: string;
  error?: string;
}) => void;

const RETRY_DELAYS_MS = [2000, 5000, 12000];
const activeTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function buildSiswaPayload(session: StudentSession) {
  return {
    studentId: session.student.studentId || session.sessionId,
    nama: session.student.name,
    kelas: session.student.grade,
    status: session.isCompleted ? 'Selesai' : 'Aktif',
    updatedAt: session.updatedAt || new Date().toISOString(),
  };
}

export function buildBankSoalPayload(pkg: QuestionPackage) {
  return {
    quizId: pkg.id,
    title: pkg.title,
    gradeLevel: pkg.gradeLevel,
    statusPublikasi: pkg.isPublished ? 'Diterbitkan' : 'Draft',
    questions: pkg.questions.map((q) => ({
      quizId: pkg.id,
      questionId: q.id,
      nomorSoal: q.number,
      jenisSoal: q.type,
      teksPertanyaan: q.prompt,
      pilihanJawaban: q.options ? q.options.map((o) => `${o.id}. ${o.text}`).join(' | ') : '-',
      kunciJawaban: q.correctAnswer || (q.keywords ? q.keywords.join(', ') : 'Belum ditentukan'),
      pembahasan: q.explanation || '',
      bobotNilai: q.points,
      statusPublikasi: pkg.isPublished ? 'Diterbitkan' : 'Draft',
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
      resultId: ans.resultId || `${session.sessionId}::${ans.questionId}`,
      timestamp: ans.answeredAt || new Date().toISOString(),
      studentId: session.student.studentId || session.sessionId,
      namaSiswa: session.student.name,
      kelas: session.student.grade,
      quizId: ans.quizId || session.packageId,
      questionId: ans.questionId,
      teksPertanyaan: ans.questionPrompt || `Soal #${ans.questionNumber}`,
      jawabanSiswa: ans.answerText,
      kunciJawaban: ans.correctAnswerSnapshot || 'Menunggu / Manual',
      nilai: ans.scoreAwarded,
      nilaiMaksimum: ans.maxPoints,
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
    sessionId: session.sessionId,
    siswa: buildSiswaPayload(session),
    hasilRows,
    rekap: {
      sessionId: session.sessionId,
      studentId: session.student.studentId || session.sessionId,
      namaSiswa: session.student.name,
      kelas: session.student.grade,
      quizId: session.packageId,
      judulKuis: session.packageTitle,
      soalSelesai: session.chestsCompleted.length,
      totalNilai: session.totalScore,
      nilaiMaksimum: session.maxPossibleScore,
      persentase: session.percentageScore,
      statusPengerjaan: session.isCompleted ? 'Selesai' : 'Berjalan',
      pendingCount,
      updatedAt: new Date().toISOString(),
    },
  };
}

async function postToAppsScript(webAppUrl: string, body: unknown): Promise<{ success: boolean; message: string; data?: unknown }> {
  if (!webAppUrl || !webAppUrl.startsWith('https://script.google.com')) {
    return {
      success: false,
      message: 'URL Google Apps Script belum dikonfigurasi atau tidak valid.',
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(webAppUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        success: false,
        message: `Google Sheets menolak permintaan (HTTP ${response.status}).`,
      };
    }

    const text = await response.text();
    try {
      const parsed = JSON.parse(text) as { success?: boolean; message?: string; data?: unknown };
      if (parsed.success === false) {
        return {
          success: false,
          message: parsed.message || 'Google Apps Script melaporkan kegagalan.',
        };
      }
      return {
        success: true,
        message: parsed.message || 'Data berhasil tersinkron ke Google Sheets.',
        data: parsed,
      };
    } catch {
      return {
        success: false,
        message: 'Respons Google Apps Script bukan JSON valid. Pastikan kode Code.gs terbaru sudah dideploy.',
      };
    }
  } catch (err) {
    clearTimeout(timeoutId);
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `Gagal menghubungi Google Sheets: ${msg}`,
    };
  }
}

export async function testAppsScriptConnection(webAppUrl: string): Promise<{ success: boolean; message: string; data?: unknown }> {
  if (!webAppUrl || !webAppUrl.startsWith('https://script.google.com')) {
    return {
      success: false,
      message: 'Format URL tidak valid. Harus dimulai dengan https://script.google.com/macros/s/...',
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const testUrl = `${webAppUrl}${webAppUrl.includes('?') ? '&' : '?'}action=status`;
    const res = await fetch(testUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) {
      return {
        success: false,
        message: `Web App merespons status HTTP ${res.status}. Pastikan akses diatur ke "Anyone / Siapa saja".`,
      };
    }

    const data = (await res.json()) as { success?: boolean; message?: string };
    return {
      success: data.success !== false,
      message: data.message || 'Koneksi ke Google Sheets berhasil terhubung!',
      data,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    return {
      success: false,
      message: `Gagal menghubungi Web App: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function syncPackageToSheets(pkg: QuestionPackage): Promise<{ success: boolean; message: string }> {
  const db = loadDatabase();
  const url = db.settings.googleSheetsWebAppUrl;
  if (!url) {
    return { success: false, message: 'URL Google Sheets belum disetel.' };
  }

  return postToAppsScript(url, {
    action: 'syncPackage',
    payload: buildBankSoalPayload(pkg),
  });
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

  // Cancel any pending retry timer for this session
  const existingTimer = activeTimers.get(sessionId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    activeTimers.delete(sessionId);
  }

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

  if (res.success) {
    const now = new Date().toISOString();
    session.syncedToSheets = true;
    session.sheetsSyncStatus = 'synced';
    session.sheetsSyncError = undefined;
    session.lastSyncedAt = now;
    saveDatabase();

    onStatus?.({
      sessionId,
      status: 'synced',
      syncedToSheets: true,
      lastSyncedAt: now,
    });
    return res;
  }

  // Honest failure reporting
  session.syncedToSheets = false;
  session.sheetsSyncStatus = 'failed';
  session.sheetsSyncError = res.message;
  saveDatabase();

  onStatus?.({
    sessionId,
    status: 'failed',
    syncedToSheets: false,
    error: res.message,
  });

  // Schedule exponential backoff retry if within max attempts
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
