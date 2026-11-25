/**
 * Unified Full-Stack Express + WebSocket + Vite Server for Pirate Academy 3D
 * Handles:
 * - PDF (<= 2MB + OCR), Word (.docx/.doc <= 2MB), Google Drive import
 * - Question image uploads (PNG/JPG/WebP <= 2MB) & safe static serving
 * - Strict validation, authoritative grading, 3D chest sync + read-back verification
 * - Real-time WS updates, Google Sheets backend sync, and Vite dev/production serving on port 3000
 * Created by Deni Raja99
 */

import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import {
  buildChestMappings,
  CHEST_PRESETS,
  deduplicateQuestions,
  getActivePublishedPackage,
  getTeacherAuthStatus,
  issueTeacherToken,
  loadDatabase,
  recalculateSessionTotals,
  recordDashboardActivity,
  recordSyncLog,
  saveDatabase,
  setupInitialTeacherPinWithSecret,
  updateTeacherPinSecurely,
  upsertAnswerInSession,
  validateTeacherToken,
  verifyTeacherLoginPin,
} from './server/db.ts';
import {
  MAX_PDF_BYTES,
  processPdfUpload,
  runOcrOnPdfBuffer,
} from './server/pdfExtractor.ts';
import {
  MAX_WORD_BYTES,
  processWordUpload,
} from './server/wordExtractor.ts';
import {
  importQuestionFileFromGoogleDrive,
} from './server/driveImporter.ts';
import {
  deleteQuestionImageByUrl,
  MAX_IMAGE_BYTES,
  resolveSafeQuestionImagePath,
  saveQuestionImageBuffer,
} from './server/imageStorage.ts';
import {
  extractSpreadsheetId,
  isValidAppsScriptUrl,
  maskSpreadsheetId,
  syncPackageToSheets,
  syncSessionNow,
  testAppsScriptConnection,
} from './server/sheetsSync.ts';
import {
  isValidQuestionImageUrl,
  validatePackageForSync,
} from './src/teacher/questionValidation.ts';
import {
  normalizeAllowedGrade,
  type Question,
  type QuestionPackage,
  type StudentSession,
} from './src/types/game.ts';

const PORT =
  process.env.NODE_ENV === 'production' ? Number(process.env.PORT) || 3000 : 3000;
const app = express();
const server = http.createServer(app);

// In-memory rate limiting for teacher authentication & initial PIN setup
const AUTH_WINDOW_MS = 5 * 60 * 1000;
const AUTH_MAX_FAILURES = 8;
const authFailureStore = new Map<string, { failures: number; resetAt: number }>();

function getClientIpKey(req: Request): string {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0]?.trim();
  return forwarded || req.ip || req.socket.remoteAddress || 'unknown';
}

function isAuthRateLimited(key: string): boolean {
  const entry = authFailureStore.get(key);
  if (!entry) return false;
  if (Date.now() >= entry.resetAt) {
    authFailureStore.delete(key);
    return false;
  }
  return entry.failures >= AUTH_MAX_FAILURES;
}

function recordAuthFailure(key: string): void {
  const now = Date.now();
  const entry = authFailureStore.get(key);
  if (!entry || now >= entry.resetAt) {
    authFailureStore.set(key, { failures: 1, resetAt: now + AUTH_WINDOW_MS });
  } else {
    entry.failures += 1;
  }
}

function clearAuthFailure(key: string): void {
  authFailureStore.delete(key);
}

// WebSocket server on /ws for real-time updates across Gameplay <-> Server <-> Portal Guru
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcastWs(type: string, payload: unknown) {
  const message = JSON.stringify({
    type,
    payload,
    timestamp: new Date().toISOString(),
  });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

wss.on('connection', (ws) => {
  ws.send(
    JSON.stringify({
      type: 'ws:connected',
      payload: { serverTime: new Date().toISOString() },
    })
  );
});

app.use(express.json({ limit: '5mb' }));
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

// Teacher Auth Middleware
function requireTeacherAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!validateTeacherToken(token)) {
    res.status(401).json({
      success: false,
      message: 'Akses ditolak. Silakan login ulang di Portal Guru dengan PIN yang valid.',
    });
    return;
  }
  next();
}

function createMulterUploadHandler(maxBytes: number, tooLargeMessage: string) {
  const uploader = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxBytes,
      files: 1,
    },
  });

  return (req: Request, res: Response, next: NextFunction) => {
    uploader.single('file')(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({
            success: false,
            message: tooLargeMessage,
          });
          return;
        }
        res.status(400).json({
          success: false,
          message: `Gagal mengunggah file: ${err.message}`,
        });
        return;
      }
      if (err) {
        res.status(400).json({
          success: false,
          message: `Kesalahan unggah: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }
      next();
    });
  };
}

const handleSinglePdfUpload = createMulterUploadHandler(
  MAX_PDF_BYTES,
  'Ukuran file melebihi batas maksimum 2 MB (2.097.152 byte). Unggahan ditolak.'
);

const handleSingleWordUpload = createMulterUploadHandler(
  MAX_WORD_BYTES,
  'Ukuran file Word melebihi batas maksimum 2 MB (2.097.152 byte). Unggahan ditolak.'
);

const handleSingleImageUpload = createMulterUploadHandler(
  MAX_IMAGE_BYTES,
  'Ukuran gambar soal melebihi batas maksimum 2 MB. Kompres gambar terlebih dahulu.'
);

// Initialize persistent database
loadDatabase();

// ========================
// PUBLIC & STUDENT ROUTES
// ========================

app.get('/api/health', (_req, res) => {
  const db = loadDatabase();
  res.json({
    ok: true,
    activePackageId: db.settings.activePackageId,
    sessionsCount: db.sessions.length,
    lastUpdatedAt: db.lastUpdatedAt,
  });
});

// Safe serving of uploaded question images
app.get('/api/question-images/:filename', (req, res) => {
  const resolved = resolveSafeQuestionImagePath(req.params.filename);
  if (!resolved) {
    res.status(404).json({ success: false, message: 'Gambar soal tidak ditemukan.' });
    return;
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(resolved);
});

app.get('/api/quiz/active', (_req, res) => {
  const active = getActivePublishedPackage();
  if (!active) {
    res.status(200).json({
      success: true,
      hasActiveQuiz: false,
      activePackage: null,
      message:
        'Belum ada paket soal aktif yang diterbitkan oleh guru. Silakan hubungi guru untuk menerbitkan paket soal di Portal Guru.',
    });
    return;
  }
  res.status(200).json({
    success: true,
    hasActiveQuiz: true,
    activePackage: active,
  });
});

app.post('/api/sessions/start', (req, res) => {
  const { studentName, grade } = req.body as { studentName?: string; grade?: string };
  const trimmedName = (studentName || '').trim();
  const normalizedGrade = normalizeAllowedGrade(grade);

  if (!trimmedName) {
    res.status(400).json({ success: false, message: 'Nama siswa wajib diisi.' });
    return;
  }

  if (!normalizedGrade) {
    res.status(400).json({
      success: false,
      message: 'Pilihan kelas tidak valid. Hanya Kelas IV (4), Kelas V (5), dan Kelas VI (6) yang diperbolehkan.',
    });
    return;
  }

  const activePkg = getActivePublishedPackage();
  if (!activePkg) {
    res.status(404).json({
      success: false,
      message: 'Belum ada paket soal aktif yang diterbitkan oleh guru.',
    });
    return;
  }

  const db = loadDatabase();
  const studentId = `stu-${trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${normalizedGrade
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')}`;
  const sessionId = `ses-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const maxPossibleScore = activePkg.questions.reduce((sum, q) => sum + (q.points || 0), 0);
  const mappings = activePkg.chestMappings || buildChestMappings(activePkg);

  const newSession: StudentSession = {
    sessionId,
    student: {
      studentId,
      name: trimmedName,
      grade: normalizedGrade,
    },
    packageId: activePkg.id,
    packageVersion: activePkg.version ?? 1,
    packageTitle: activePkg.title,
    startTime: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isCompleted: false,
    totalScore: 0,
    maxPossibleScore,
    percentageScore: 0,
    chestMappings: mappings,
    answers: {},
    chestsCompleted: [],
    syncedToSheets: false,
    sheetsSyncStatus: 'idle',
  };

  db.sessions.unshift(newSession);
  saveDatabase();
  broadcastWs('session:updated', newSession);

  res.json({
    success: true,
    session: newSession,
    activePackage: activePkg,
  });
});

app.get('/api/sessions/:sessionId', (req, res) => {
  const db = loadDatabase();
  const session = db.sessions.find((s) => s.sessionId === req.params.sessionId);
  if (!session) {
    res.status(404).json({ success: false, message: 'Sesi tidak ditemukan.' });
    return;
  }
  res.json({ success: true, session });
});

app.post('/api/sessions/:sessionId/progress', (req, res) => {
  const { sessionId } = req.params;
  const body = req.body as {
    x?: unknown;
    y?: unknown;
    z?: unknown;
    rotationY?: unknown;
    cameraYaw?: unknown;
    cameraPitch?: unknown;
  };

  const x = Number(body?.x);
  const y = Number(body?.y);
  const z = Number(body?.z);
  const rotationY = Number(body?.rotationY ?? 0);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(rotationY)) {
    res.status(400).json({ success: false, message: 'Koordinat posisi karakter tidak valid.' });
    return;
  }

  const db = loadDatabase();
  const session = db.sessions.find((s) => s.sessionId === sessionId);
  if (!session) {
    res.status(404).json({ success: false, message: 'Sesi tidak ditemukan.' });
    return;
  }
  if (session.isCompleted) {
    res.status(409).json({
      success: false,
      message: 'Sesi sudah selesai sehingga posisi tidak dapat diubah.',
    });
    return;
  }

  const nowIso = new Date().toISOString();
  const cameraYaw = body?.cameraYaw !== undefined && Number.isFinite(Number(body.cameraYaw))
    ? Number(body.cameraYaw)
    : undefined;
  const cameraPitch = body?.cameraPitch !== undefined && Number.isFinite(Number(body.cameraPitch))
    ? Number(body.cameraPitch)
    : undefined;

  session.lastPosition = {
    x: Number(x.toFixed(3)),
    y: Number(y.toFixed(3)),
    z: Number(z.toFixed(3)),
    rotationY: Number(rotationY.toFixed(4)),
    ...(cameraYaw !== undefined ? { cameraYaw: Number(cameraYaw.toFixed(4)) } : {}),
    ...(cameraPitch !== undefined ? { cameraPitch: Number(cameraPitch.toFixed(4)) } : {}),
    updatedAt: nowIso,
  };
  session.updatedAt = nowIso;
  saveDatabase();

  res.json({
    success: true,
    lastPosition: session.lastPosition,
  });
});

app.post('/api/sessions/:sessionId/answer', async (req, res) => {
  const { sessionId } = req.params;
  const { questionId, answerText, chestId, durationSeconds } = req.body as {
    questionId?: string;
    answerText?: string;
    chestId?: string;
    durationSeconds?: number;
  };

  if (!questionId || typeof answerText !== 'string' || !answerText.trim()) {
    res.status(400).json({ success: false, message: 'ID soal dan jawaban wajib diisi.' });
    return;
  }

  const db = loadDatabase();
  let session = db.sessions.find((s) => s.sessionId === sessionId);
  if (!session) {
    res.status(404).json({ success: false, message: 'Sesi pengerjaan tidak ditemukan.' });
    return;
  }

  const pkg =
    db.packages.find((p) => p.id === session!.packageId) || getActivePublishedPackage();
  const question = pkg?.questions.find((q) => q.id === questionId);
  if (!question) {
    res.status(404).json({
      success: false,
      message: `Soal dengan ID "${questionId}" tidak ditemukan dalam paket kuis sesi ini.`,
    });
    return;
  }

  const result = upsertAnswerInSession(session, question, answerText, chestId, durationSeconds);
  session = result.session;
  if (!result.alreadySubmitted) {
    saveDatabase();
    broadcastWs('session:updated', session);

    if (db.settings.autoSyncSheets && db.settings.googleSheetsWebAppUrl) {
      void syncSessionNow(session.sessionId, (statusEvt) => {
        broadcastWs('sheets:sync_status', statusEvt);
        const refreshed = loadDatabase().sessions.find((s) => s.sessionId === sessionId);
        if (refreshed) broadcastWs('session:updated', refreshed);
      });
    }
  }

  res.json({
    success: true,
    alreadySubmitted: result.alreadySubmitted,
    answer: result.answer,
    session,
  });
});

app.post('/api/sessions/:sessionId/complete', async (req, res) => {
  const { sessionId } = req.params;
  const db = loadDatabase();
  const session = db.sessions.find((s) => s.sessionId === sessionId);
  if (!session) {
    res.status(404).json({ success: false, message: 'Sesi siswa tidak ditemukan.' });
    return;
  }

  session.isCompleted = true;
  session.endTime = session.endTime || new Date().toISOString();
  recalculateSessionTotals(session);
  saveDatabase();

  broadcastWs('session:updated', session);

  let syncResult: { success: boolean; message: string } | null = null;
  if (db.settings.autoSyncSheets && db.settings.googleSheetsWebAppUrl) {
    syncResult = await syncSessionNow(session.sessionId, (statusEvt) => {
      broadcastWs('sheets:sync_status', statusEvt);
    });
    const updated = db.sessions.find((s) => s.sessionId === sessionId);
    if (updated) broadcastWs('session:updated', updated);
  }

  res.json({
    success: true,
    session: db.sessions.find((s) => s.sessionId === sessionId) || session,
    syncResult,
  });
});

app.post('/api/sessions/:sessionId/sync-sheets', async (req, res) => {
  const { sessionId } = req.params;
  const result = await syncSessionNow(sessionId, (statusEvt) => {
    broadcastWs('sheets:sync_status', statusEvt);
  });
  const db = loadDatabase();
  const session = db.sessions.find((s) => s.sessionId === sessionId);
  if (session) broadcastWs('session:updated', session);

  res.status(result.success ? 200 : 502).json({
    success: result.success,
    message: result.message,
    session,
  });
});

// ========================
// TEACHER PORTAL ROUTES
// ========================

app.get('/api/teacher/auth-status', (_req, res) => {
  const status = getTeacherAuthStatus();
  res.json({
    success: true,
    ...status,
  });
});

app.post('/api/teacher/setup-pin', (req, res) => {
  const clientKey = `setup:${getClientIpKey(req)}`;
  if (isAuthRateLimited(clientKey)) {
    res.status(429).json({
      success: false,
      message: 'Terlalu banyak percobaan setup PIN. Silakan tunggu 5 menit sebelum mencoba lagi.',
    });
    return;
  }

  const { setupSecret, newPin } = (req.body || {}) as {
    setupSecret?: string;
    newPin?: string;
  };

  const result = setupInitialTeacherPinWithSecret(
    typeof setupSecret === 'string' ? setupSecret : '',
    typeof newPin === 'string' ? newPin : ''
  );

  if (!result.success) {
    if (result.status === 401 || result.status === 403) {
      recordAuthFailure(clientKey);
    }
    res.status(result.status).json({
      success: false,
      message: result.message,
      authStatus: getTeacherAuthStatus(),
    });
    return;
  }

  clearAuthFailure(clientKey);
  res.json({
    success: true,
    message: result.message,
    authStatus: getTeacherAuthStatus(),
  });
});

app.post('/api/teacher/login', (req, res) => {
  const clientKey = `login:${getClientIpKey(req)}`;
  if (isAuthRateLimited(clientKey)) {
    res.status(429).json({
      success: false,
      message: 'Terlalu banyak percobaan PIN salah. Silakan tunggu 5 menit sebelum mencoba lagi.',
    });
    return;
  }

  const status = getTeacherAuthStatus();
  if (!status.pinConfigured) {
    res.status(403).json({
      success: false,
      requiresInitialSetup: true,
      setupSecretConfigured: status.setupSecretConfigured,
      message:
        'PIN Portal Guru belum dikonfigurasi. Lakukan setup awal aman menggunakan secret server (TEACHER_SETUP_SECRET) terlebih dahulu.',
    });
    return;
  }

  const { pin } = (req.body || {}) as { pin?: string };
  if (typeof pin !== 'string' || !verifyTeacherLoginPin(pin)) {
    recordAuthFailure(clientKey);
    res.status(401).json({
      success: false,
      message: 'PIN salah! Silakan masukkan PIN guru yang valid.',
    });
    return;
  }

  clearAuthFailure(clientKey);
  const token = issueTeacherToken();
  res.json({
    success: true,
    token,
    message: 'Autentikasi Portal Guru berhasil.',
  });
});

app.get('/api/teacher/overview', requireTeacherAuth, (_req, res) => {
  const db = loadDatabase();
  res.json({
    success: true,
    syncLogs: db.syncLogs || [],
    activities: db.activities || [],
    lastUpdatedAt: db.lastUpdatedAt,
  });
});

app.get('/api/teacher/packages', requireTeacherAuth, (_req, res) => {
  const db = loadDatabase();
  res.json({
    success: true,
    packages: db.packages,
    activePackageId: db.settings.activePackageId,
  });
});

app.post('/api/teacher/packages', requireTeacherAuth, (req, res) => {
  const pkgInput = req.body as Partial<QuestionPackage>;
  if (!pkgInput || !pkgInput.title || !Array.isArray(pkgInput.questions)) {
    res.status(400).json({
      success: false,
      message: 'Judul paket dan daftar soal wajib diisi.',
    });
    return;
  }

  const db = loadDatabase();
  const now = new Date().toISOString();

  const rawNormalized: Question[] = pkgInput.questions.map((q, idx) => {
    const preset = CHEST_PRESETS[idx % CHEST_PRESETS.length];
    const cleanImgUrl =
      typeof q.imageUrl === 'string' && q.imageUrl.trim() && isValidQuestionImageUrl(q.imageUrl)
        ? q.imageUrl.trim()
        : undefined;

    return {
      ...q,
      id: q.id || `q-${Date.now()}-${idx + 1}`,
      number: idx + 1,
      points: Math.max(1, Number(q.points) || 10),
      isActive: q.isActive !== false,
      imageUrl: cleanImgUrl,
      imageAlt: cleanImgUrl ? (q.imageAlt || '').trim() : undefined,
      imagePosition: q.imagePosition === 'before' ? 'before' : 'after',
      updatedAt: q.updatedAt || now,
      chestPosition: q.chestPosition || preset,
      locationName: q.locationName || preset.name,
    };
  });
  const { questions: normalizedQuestions } = deduplicateQuestions(rawNormalized);

  const cleanClientReqId =
    typeof pkgInput.clientRequestId === 'string' && pkgInput.clientRequestId.trim()
      ? pkgInput.clientRequestId.trim()
      : undefined;

  const existingIdx = pkgInput.id
    ? db.packages.findIndex((p) => p.id === pkgInput.id)
    : cleanClientReqId
    ? db.packages.findIndex((p) => p.clientRequestId === cleanClientReqId)
    : -1;

  let savedPkg: QuestionPackage;
  let deduplicated = false;
  if (existingIdx >= 0) {
    const existing = db.packages[existingIdx];
    deduplicated = Boolean(!pkgInput.id && cleanClientReqId);
    const draftCandidate: QuestionPackage = {
      ...existing,
      ...pkgInput,
      id: existing.id,
      clientRequestId: cleanClientReqId || existing.clientRequestId,
      title: pkgInput.title.trim(),
      description: (pkgInput.description ?? existing.description ?? '').trim(),
      gradeLevel: pkgInput.gradeLevel || existing.gradeLevel || 'Kelas 5 SD',
      questions: normalizedQuestions,
      updatedAt: now,
    };
    const val = validatePackageForSync(draftCandidate);
    draftCandidate.lastSyncStatus = !val.valid
      ? 'needs_fix'
      : existing.id === db.settings.activePackageId
      ? 'pending_sync'
      : existing.isPublished
      ? 'ready'
      : 'draft';
    draftCandidate.chestMappings = buildChestMappings(draftCandidate);
    savedPkg = draftCandidate;
    db.packages[existingIdx] = savedPkg;
  } else {
    const newId = pkgInput.id || `quiz-${Date.now()}`;
    const draftCandidate: QuestionPackage = {
      id: newId,
      version: 1,
      title: pkgInput.title.trim(),
      description: (pkgInput.description || 'Paket soal hasil penyusunan di Portal Guru').trim(),
      gradeLevel: pkgInput.gradeLevel || 'Kelas 5 SD',
      timeLimitMinutes: pkgInput.timeLimitMinutes || 0,
      isSequential: Boolean(pkgInput.isSequential),
      showInstantFeedback: pkgInput.showInstantFeedback !== false,
      createdAt: now,
      updatedAt: now,
      status: 'draft',
      isPublished: false,
      sourceType: pkgInput.sourceType || (pkgInput.sourcePdfName ? 'pdf' : 'manual'),
      sourceFileName: pkgInput.sourceFileName || pkgInput.sourcePdfName,
      sourceFileSizeBytes: pkgInput.sourceFileSizeBytes || pkgInput.sourcePdfSizeBytes,
      sourcePdfName: pkgInput.sourcePdfName || pkgInput.sourceFileName,
      sourcePdfSizeBytes: pkgInput.sourcePdfSizeBytes || pkgInput.sourceFileSizeBytes,
      clientRequestId: cleanClientReqId,
      questions: normalizedQuestions,
    };
    const val = validatePackageForSync(draftCandidate);
    draftCandidate.lastSyncStatus = val.valid ? 'ready' : 'needs_fix';
    draftCandidate.chestMappings = buildChestMappings(draftCandidate);
    savedPkg = draftCandidate;
    db.packages.unshift(savedPkg);
  }

  saveDatabase();
  if (!deduplicated) {
    recordDashboardActivity({
      category: 'edit',
      status: savedPkg.lastSyncStatus === 'needs_fix' ? 'warning' : 'success',
      title: 'Draf Paket Soal Disimpan',
      detail: `"${savedPkg.title}" (${savedPkg.questions.length} soal total, ${(savedPkg.chestMappings || []).length} soal aktif).`,
    });
  }

  res.json({
    success: true,
    deduplicated,
    package: savedPkg,
    message: deduplicated
      ? 'Draf paket soal sudah tersimpan sebelumnya (duplikasi dicegah).'
      : 'Draf paket soal berhasil disimpan.',
  });
});

async function executePublishAndSync(params: {
  packageId: string;
  createNewVersion?: boolean;
  syncToSheets?: boolean;
}) {
  const { packageId, createNewVersion = false, syncToSheets = true } = params;
  const db = loadDatabase();
  const target = db.packages.find((p) => p.id === packageId);
  const opId = `op-sync-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  if (!target) {
    return {
      httpStatus: 404,
      body: { success: false, message: 'Paket soal tidak ditemukan.' },
    };
  }

  // Strict pre-sync validation gate
  const validation = validatePackageForSync(target);
  if (!validation.valid) {
    const firstErr =
      validation.summaryErrors[0] ||
      Object.values(validation.questionErrors)[0]?.[0] ||
      'Terdapat soal yang belum valid.';

    target.lastSyncStatus = 'needs_fix';
    target.lastSyncError = firstErr;
    saveDatabase();

    recordSyncLog({
      id: opId,
      operationType: 'sync_game',
      target: 'game_3d',
      packageId: target.id,
      packageTitle: target.title,
      status: 'failed',
      itemCount: validation.activeCount,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
      message: `Validasi gagal: ${firstErr}`,
      verifiedReadBack: false,
    });

    return {
      httpStatus: 400,
      body: {
        success: false,
        message: `Sinkronisasi ditolak: ${firstErr}`,
        validation,
        operationId: opId,
      },
    };
  }

  // Snapshot previous state so any unexpected failure never breaks active game data
  const previousActiveId = db.settings.activePackageId;
  const now = new Date().toISOString();
  let publishedPkg: QuestionPackage;

  try {
    if (createNewVersion && target.isPublished) {
      const nextVersion = (target.version || 1) + 1;
      const newQuizId = `${target.id.replace(/-v\d+$/, '')}-v${nextVersion}`;
      publishedPkg = {
        ...target,
        id: newQuizId,
        version: nextVersion,
        status: 'published',
        isPublished: true,
        publishedAt: now,
        updatedAt: now,
        questions: target.questions.map((q, idx) => ({
          ...q,
          id: `${q.id}-v${nextVersion}-${idx + 1}`,
          number: idx + 1,
        })),
      };
      publishedPkg.chestMappings = buildChestMappings(publishedPkg);
      db.packages.unshift(publishedPkg);
    } else {
      target.status = 'published';
      target.isPublished = true;
      target.version = target.version || 1;
      target.publishedAt = now;
      target.updatedAt = now;
      target.questions = target.questions.map((q, idx) => ({ ...q, number: idx + 1 }));
      target.chestMappings = buildChestMappings(target);
      publishedPkg = target;
    }

    db.settings.activePackageId = publishedPkg.id;
    saveDatabase();

    // Read-back verification from authoritative game endpoint source
    const verifiedPkg = getActivePublishedPackage();
    const expectedActiveCount = publishedPkg.questions.filter((q) => q.isActive !== false).length;
    const readBackOk = Boolean(
      verifiedPkg &&
        verifiedPkg.id === publishedPkg.id &&
        verifiedPkg.questions.length === expectedActiveCount &&
        (verifiedPkg.chestMappings || []).length === expectedActiveCount
    );

    if (!readBackOk) {
      db.settings.activePackageId = previousActiveId;
      publishedPkg.lastSyncStatus = 'failed';
      publishedPkg.lastSyncError = 'Verifikasi read-back paket aktif gagal.';
      saveDatabase();
      return {
        httpStatus: 500,
        body: {
          success: false,
          message: 'Verifikasi read-back ke penyimpanan game 3D gagal. Paket aktif sebelumnya tetap dipertahankan.',
          operationId: opId,
        },
      };
    }

    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - startMs;

    publishedPkg.lastSyncedAt = finishedAt;
    publishedPkg.lastSyncStatus = 'synced';
    publishedPkg.lastSyncError = undefined;
    publishedPkg.lastOperationId = opId;
    publishedPkg.lastSyncDurationMs = durationMs;
    saveDatabase();

    broadcastWs('quiz:published', verifiedPkg);

    recordSyncLog({
      id: opId,
      operationType: 'sync_game',
      target: syncToSheets && db.settings.googleSheetsWebAppUrl ? 'both' : 'game_3d',
      packageId: publishedPkg.id,
      packageTitle: publishedPkg.title,
      status: 'success',
      itemCount: expectedActiveCount,
      startedAt,
      finishedAt,
      durationMs,
      message: `Game 3D & ${expectedActiveCount} peti soal aktif terverifikasi.`,
      verifiedReadBack: true,
    });

    recordDashboardActivity({
      category: 'sync',
      status: 'success',
      title: 'Sinkronisasi ke Game 3D Berhasil',
      detail: `Paket "${publishedPkg.title}" aktif dengan ${expectedActiveCount} peti soal (${durationMs} ms).`,
    });

    let sheetsSyncResult: { success: boolean; message: string; operationId?: string; durationMs?: number } | null = null;
    if (syncToSheets && db.settings.googleSheetsWebAppUrl && db.settings.autoSyncSheets) {
      sheetsSyncResult = await syncPackageToSheets(publishedPkg, `${opId}-gs`);
    }

    return {
      httpStatus: 200,
      body: {
        success: true,
        package: publishedPkg,
        verifiedActivePackage: verifiedPkg,
        activePackageId: db.settings.activePackageId,
        operationId: opId,
        durationMs,
        verifiedReadBack: true,
        sheetsSyncResult,
        message: `Paket "${publishedPkg.title}" berhasil diterbitkan & diverifikasi (${expectedActiveCount} peti aktif)!`,
      },
    };
  } catch (err) {
    db.settings.activePackageId = previousActiveId;
    saveDatabase();
    return {
      httpStatus: 500,
      body: {
        success: false,
        message: `Gagal menerbitkan paket: ${err instanceof Error ? err.message : String(err)}`,
        operationId: opId,
      },
    };
  }
}

app.post('/api/teacher/packages/:id/publish', requireTeacherAuth, async (req, res) => {
  const { createNewVersion, syncToSheets } = (req.body || {}) as {
    createNewVersion?: boolean;
    syncToSheets?: boolean;
  };
  const result = await executePublishAndSync({
    packageId: req.params.id,
    createNewVersion: Boolean(createNewVersion),
    syncToSheets: syncToSheets !== false,
  });
  res.status(result.httpStatus).json(result.body);
});

app.post('/api/teacher/packages/:id/sync-game', requireTeacherAuth, async (req, res) => {
  const { createNewVersion, syncToSheets } = (req.body || {}) as {
    createNewVersion?: boolean;
    syncToSheets?: boolean;
  };
  const result = await executePublishAndSync({
    packageId: req.params.id,
    createNewVersion: Boolean(createNewVersion),
    syncToSheets: syncToSheets !== false,
  });
  res.status(result.httpStatus).json(result.body);
});

app.post('/api/teacher/packages/:id/sync-sheets', requireTeacherAuth, async (req, res) => {
  const db = loadDatabase();
  const pkg = db.packages.find((p) => p.id === req.params.id);
  if (!pkg) {
    res.status(404).json({ success: false, message: 'Paket soal tidak ditemukan.' });
    return;
  }
  const result = await syncPackageToSheets(pkg);
  res.status(result.success ? 200 : 502).json(result);
});

app.delete('/api/teacher/packages/:id', requireTeacherAuth, (req, res) => {
  const db = loadDatabase();
  const targetId = req.params.id;
  if (db.packages.length <= 1) {
    res.status(400).json({
      success: false,
      message: 'Minimal harus ada 1 paket soal tersisa.',
    });
    return;
  }
  const deleted = db.packages.find((p) => p.id === targetId);
  db.packages = db.packages.filter((p) => p.id !== targetId);
  if (db.settings.activePackageId === targetId) {
    const nextPublished = db.packages.find((p) => p.isPublished);
    db.settings.activePackageId = nextPublished ? nextPublished.id : '';
  }
  saveDatabase();
  if (deleted) {
    recordDashboardActivity({
      category: 'edit',
      status: 'info',
      title: 'Paket Soal Dihapus',
      detail: `Paket "${deleted.title}" telah dihapus dari daftar.`,
    });
  }
  res.json({
    success: true,
    packages: db.packages,
    activePackageId: db.settings.activePackageId,
  });
});

// ========================
// QUESTION IMAGE UPLOAD / DELETE
// ========================

app.post('/api/teacher/questions/image', requireTeacherAuth, handleSingleImageUpload, (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: 'Tidak ada file gambar yang diterima server.' });
      return;
    }
    const saved = saveQuestionImageBuffer(req.file.buffer, req.file.originalname);
    res.json({
      success: true,
      ...saved,
      message: 'Gambar soal berhasil diunggah.',
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err instanceof Error ? err.message : 'Gagal mengunggah gambar soal.',
    });
  }
});

app.delete('/api/teacher/questions/image', requireTeacherAuth, (req, res) => {
  const { imageUrl } = (req.body || {}) as { imageUrl?: string };
  if (!imageUrl) {
    res.status(400).json({ success: false, message: 'URL gambar wajib disertakan.' });
    return;
  }
  const removed = deleteQuestionImageByUrl(imageUrl);
  res.json({
    success: true,
    removed,
    message: removed ? 'File gambar berhasil dihapus dari server.' : 'Referensi gambar dihapus.',
  });
});

// ========================
// IMPORTERS: PDF, WORD, GOOGLE DRIVE
// ========================

app.post('/api/teacher/pdf/upload', requireTeacherAuth, handleSinglePdfUpload, async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({
        success: false,
        message: 'Tidak ada file PDF yang diterima server.',
      });
      return;
    }

    const requestId =
      (req.headers['x-request-id'] as string | undefined) ||
      (req.body?.requestId as string | undefined) ||
      undefined;

    const result = await processPdfUpload(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );
    recordDashboardActivity({
      category: 'import',
      status: result.questions.length > 0 ? 'success' : 'warning',
      title: 'Impor PDF Selesai',
      detail: `${req.file.originalname}: ${result.questions.length} soal dikenali (${result.needsReviewCount} perlu cek).`,
    });
    res.type('application/json; charset=utf-8').json({
      ...result,
      requestId,
    });
  } catch (err) {
    res.status(400).type('application/json; charset=utf-8').json({
      success: false,
      message: err instanceof Error ? err.message : 'Gagal mengekstrak file PDF.',
    });
  }
});

app.post('/api/teacher/pdf/ocr', requireTeacherAuth, handleSinglePdfUpload, async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({
        success: false,
        message: 'Tidak ada file PDF yang dikirim untuk OCR.',
      });
      return;
    }

    const requestId =
      (req.headers['x-request-id'] as string | undefined) ||
      (req.body?.requestId as string | undefined) ||
      undefined;

    const result = await runOcrOnPdfBuffer(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );
    recordDashboardActivity({
      category: 'import',
      status: 'success',
      title: 'Ekstraksi OCR PDF Selesai',
      detail: `${req.file.originalname}: ${result.questions.length} soal dibaca via OCR.`,
    });
    res.type('application/json; charset=utf-8').json({
      ...result,
      requestId,
    });
  } catch (err) {
    res.status(400).type('application/json; charset=utf-8').json({
      success: false,
      message: err instanceof Error ? err.message : 'Gagal memproses OCR PDF.',
    });
  }
});

app.post('/api/teacher/word/upload', requireTeacherAuth, handleSingleWordUpload, async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({
        success: false,
        message: 'Tidak ada file Word (.docx/.doc) yang diterima server.',
      });
      return;
    }

    const requestId =
      (req.headers['x-request-id'] as string | undefined) ||
      (req.body?.requestId as string | undefined) ||
      undefined;

    const result = await processWordUpload(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );
    recordDashboardActivity({
      category: 'import',
      status: result.questions.length > 0 ? 'success' : 'warning',
      title: 'Impor Word Selesai',
      detail: `${req.file.originalname}: ${result.questions.length} soal dikenali.`,
    });
    res.type('application/json; charset=utf-8').json({
      ...result,
      requestId,
    });
  } catch (err) {
    res.status(400).type('application/json; charset=utf-8').json({
      success: false,
      message: err instanceof Error ? err.message : 'Gagal mengekstrak file Word.',
    });
  }
});

app.post('/api/teacher/drive/import', requireTeacherAuth, async (req, res) => {
  try {
    const { fileIdOrUrl, driveAccessToken } = (req.body || {}) as {
      fileIdOrUrl?: string;
      driveAccessToken?: string;
    };

    if (!fileIdOrUrl || !fileIdOrUrl.trim()) {
      res.status(400).json({
        success: false,
        message: 'Tautan atau ID file Google Drive wajib diisi.',
      });
      return;
    }

    const result = await importQuestionFileFromGoogleDrive({
      fileIdOrUrl,
      driveAccessToken,
    });
    recordDashboardActivity({
      category: 'import',
      status: result.questions.length > 0 ? 'success' : 'warning',
      title: 'Impor Google Drive Selesai',
      detail: `${result.fileName}: ${result.questions.length} soal dikenali.`,
    });
    res.type('application/json; charset=utf-8').json(result);
  } catch (err) {
    res.status(400).type('application/json; charset=utf-8').json({
      success: false,
      message: err instanceof Error ? err.message : 'Gagal mengimpor file dari Google Drive.',
    });
  }
});

// ========================
// STUDENT RESULTS & MANUAL GRADING
// ========================

app.get('/api/teacher/sessions', requireTeacherAuth, (_req, res) => {
  const db = loadDatabase();
  res.json({
    success: true,
    sessions: db.sessions,
    lastUpdatedAt: db.lastUpdatedAt,
  });
});

app.post('/api/teacher/sessions/:sessionId/grade', requireTeacherAuth, async (req, res) => {
  const { sessionId } = req.params;
  const { questionId, scoreAwarded, teacherFeedback, gradedBy } = req.body as {
    questionId?: string;
    scoreAwarded?: number;
    teacherFeedback?: string;
    gradedBy?: string;
  };

  if (!questionId || typeof scoreAwarded !== 'number') {
    res.status(400).json({ success: false, message: 'ID soal dan nilai angka wajib diisi.' });
    return;
  }

  const db = loadDatabase();
  const session = db.sessions.find((s) => s.sessionId === sessionId);
  if (!session || !session.answers[questionId]) {
    res.status(404).json({ success: false, message: 'Jawaban siswa tidak ditemukan.' });
    return;
  }

  const ans = session.answers[questionId];
  const clamped = Math.min(ans.maxPoints || 100, Math.max(0, Number(scoreAwarded)));
  ans.scoreAwarded = clamped;
  ans.teacherFeedback = (teacherFeedback || '').trim();
  ans.isGradedManually = true;
  ans.gradingStatus = 'graded';
  ans.isCorrect = clamped >= Math.ceil((ans.maxPoints || 1) * 0.6);
  ans.gradedBy = (gradedBy || 'Guru').trim();
  ans.gradedAt = new Date().toISOString();

  recalculateSessionTotals(session);
  saveDatabase();

  recordDashboardActivity({
    category: 'grading',
    status: 'success',
    title: 'Koreksi Manual Disimpan',
    detail: `${session.student.name} • Soal #${ans.questionNumber}: ${clamped}/${ans.maxPoints} poin.`,
  });

  broadcastWs('session:updated', session);

  if (db.settings.autoSyncSheets && db.settings.googleSheetsWebAppUrl) {
    void syncSessionNow(session.sessionId, (statusEvt) => {
      broadcastWs('sheets:sync_status', statusEvt);
    });
  }

  res.json({
    success: true,
    session,
  });
});

app.post('/api/teacher/sessions/:sessionId/retry-sync', requireTeacherAuth, async (req, res) => {
  const result = await syncSessionNow(req.params.sessionId, (statusEvt) => {
    broadcastWs('sheets:sync_status', statusEvt);
  });
  const db = loadDatabase();
  const session = db.sessions.find((s) => s.sessionId === req.params.sessionId);
  if (session) broadcastWs('session:updated', session);

  res.status(result.success ? 200 : 502).json({
    success: result.success,
    message: result.message,
    session,
  });
});

// ========================
// TEACHER SETTINGS & GOOGLE SHEETS TEST
// ========================

function buildSafeSettingsResponse() {
  const db = loadDatabase();
  const authStatus = getTeacherAuthStatus();
  const spreadsheetId = extractSpreadsheetId(db.settings.spreadsheetIdOrUrl);
  return {
    googleSheetsWebAppUrl: db.settings.googleSheetsWebAppUrl,
    spreadsheetIdOrUrl: db.settings.spreadsheetIdOrUrl || '',
    maskedSpreadsheetId: maskSpreadsheetId(db.settings.spreadsheetIdOrUrl),
    spreadsheetOpenUrl: spreadsheetId
      ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
      : '',
    autoSyncSheets: db.settings.autoSyncSheets,
    activePackageId: db.settings.activePackageId,
    pinConfigured: authStatus.pinConfigured,
    pinManagedByEnv: authStatus.pinManagedByEnv,
    sheetsSharedSecretConfigured: Boolean(db.settings.sheetsSharedSecret),
    sheetsLastSyncAt: db.settings.sheetsLastSyncAt || '',
    sheetsLastError: db.settings.sheetsLastError || '',
  };
}

app.get('/api/teacher/settings', requireTeacherAuth, (_req, res) => {
  res.json({
    success: true,
    settings: buildSafeSettingsResponse(),
  });
});

app.put('/api/teacher/settings', requireTeacherAuth, (req, res) => {
  const {
    googleSheetsWebAppUrl,
    spreadsheetIdOrUrl,
    sheetsSharedSecret,
    clearSharedSecret,
    autoSyncSheets,
    activePackageId,
    newPin,
  } = req.body as {
    googleSheetsWebAppUrl?: string;
    spreadsheetIdOrUrl?: string;
    sheetsSharedSecret?: string;
    clearSharedSecret?: boolean;
    autoSyncSheets?: boolean;
    activePackageId?: string;
    newPin?: string;
  };
  const db = loadDatabase();

  if (typeof googleSheetsWebAppUrl === 'string') {
    const trimmedUrl = googleSheetsWebAppUrl.trim();
    if (trimmedUrl && !isValidAppsScriptUrl(trimmedUrl)) {
      res.status(400).json({
        success: false,
        message: 'URL Web App Google Apps Script tidak valid (harus diawali https://script.google.com/...).',
      });
      return;
    }
    db.settings.googleSheetsWebAppUrl = trimmedUrl;
  }

  if (typeof spreadsheetIdOrUrl === 'string') {
    db.settings.spreadsheetIdOrUrl = spreadsheetIdOrUrl.trim();
  }

  if (clearSharedSecret) {
    db.settings.sheetsSharedSecret = undefined;
  } else if (typeof sheetsSharedSecret === 'string' && sheetsSharedSecret.trim()) {
    db.settings.sheetsSharedSecret = sheetsSharedSecret.trim();
  }

  if (typeof autoSyncSheets === 'boolean') {
    db.settings.autoSyncSheets = autoSyncSheets;
  }

  if (typeof activePackageId === 'string') {
    db.settings.activePackageId = activePackageId;
    const activePkg = getActivePublishedPackage();
    if (activePkg) broadcastWs('quiz:published', activePkg);
  }

  if (typeof newPin === 'string' && newPin.trim().length > 0) {
    const pinUpdate = updateTeacherPinSecurely(newPin);
    if (!pinUpdate.success) {
      res.status(400).json({
        success: false,
        message: pinUpdate.message,
      });
      return;
    }
  }

  saveDatabase();
  recordDashboardActivity({
    category: 'settings',
    status: 'success',
    title: 'Pengaturan Integrasi Diperbarui',
    detail: 'Konfigurasi Portal Guru berhasil disimpan.',
  });

  res.json({
    success: true,
    settings: buildSafeSettingsResponse(),
    message: 'Pengaturan Portal Guru berhasil disimpan.',
  });
});

app.post('/api/teacher/sheets/test', requireTeacherAuth, async (req, res) => {
  const { url } = (req.body || {}) as { url?: string };
  const db = loadDatabase();
  const targetUrl = (url || db.settings.googleSheetsWebAppUrl || '').trim();
  const result = await testAppsScriptConnection(targetUrl);
  res.status(result.success ? 200 : 400).json(result);
});

// Guarantee /api/* never falls through to Vite SPA HTML (HTTP 200) or Express HTML errors
app.use('/api', (req, res) => {
  res.status(404).type('application/json; charset=utf-8').json({
    success: false,
    message: `Endpoint API tidak ditemukan (${req.method} ${req.path}).`,
  });
});

app.use('/api', (err: unknown, req: Request, res: Response, _next: NextFunction) => {
  console.warn('[PirateAcademy Server API Error]', {
    method: req.method,
    path: req.path,
    errorType: err instanceof Error ? err.name : 'UnknownError',
  });
  if (res.headersSent) return;
  res.status(500).type('application/json; charset=utf-8').json({
    success: false,
    message:
      err instanceof Error && err.message
        ? `Kesalahan server saat memproses permintaan: ${err.message}`
        : 'Terjadi kesalahan internal pada server API.',
  });
});

// ========================
// VITE / STATIC SERVING
// ========================

const DEFAULT_PUBLIC_ORIGIN =
  'https://ais-pre-kvauz3ffvwjgw4vguqkyfw-518887689182.asia-southeast1.run.app';

function resolvePublicOrigin(req: Request): string {
  const envUrl = (
    process.env.PUBLIC_APP_URL ||
    process.env.SHARED_APP_URL ||
    ''
  ).trim();
  if (envUrl.startsWith('https://')) {
    return envUrl.replace(/\/+$/, '');
  }

  const forwardedHostRaw = req.headers['x-forwarded-host'] || req.headers.host || '';
  const host = String(forwardedHostRaw)
    .split(',')[0]
    ?.trim()
    .toLowerCase()
    .replace(/:443$/, '') || '';
  const isValidPublicHost =
    /^[a-z0-9.-]+(:\d+)?$/.test(host) &&
    !host.startsWith('localhost') &&
    !host.startsWith('127.0.0.1') &&
    !host.startsWith('0.0.0.0') &&
    !host.startsWith('ais-dev-');

  if (isValidPublicHost) {
    return `https://${host}`;
  }

  const appUrl = (process.env.APP_URL || '').trim();
  if (appUrl.startsWith('https://') && !appUrl.includes('://ais-dev-')) {
    return appUrl.replace(/\/+$/, '');
  }

  return DEFAULT_PUBLIC_ORIGIN;
}

function injectPublicOriginIntoHtml(html: string, req: Request): string {
  const origin = resolvePublicOrigin(req);
  if (origin === DEFAULT_PUBLIC_ORIGIN) {
    return html;
  }
  return html.split(DEFAULT_PUBLIC_ORIGIN).join(origin);
}

async function startServer() {
  const publicOgCoverPath = path.resolve(process.cwd(), 'public', 'og-cover.jpg');
  const distOgCoverPath = path.resolve(process.cwd(), 'dist', 'og-cover.jpg');

  app.get('/og-cover.jpg', (_req, res, next) => {
    const filePath = fs.existsSync(distOgCoverPath)
      ? distOgCoverPath
      : fs.existsSync(publicOgCoverPath)
      ? publicOgCoverPath
      : null;
    if (!filePath) {
      next();
      return;
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(filePath);
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.get('/', async (req, res, next) => {
      try {
        const indexPath = path.resolve(process.cwd(), 'index.html');
        const rawHtml = fs.readFileSync(indexPath, 'utf-8');
        const transformed = await vite.transformIndexHtml(req.originalUrl, rawHtml);
        res
          .status(200)
          .type('text/html; charset=utf-8')
          .send(injectPublicOriginIntoHtml(transformed, req));
      } catch (err) {
        next(err);
      }
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    const distIndexPath = path.join(distDir, 'index.html');
    app.use(express.static(distDir, { index: false }));
    app.get('*', (_req, res) => {
      const rawHtml = fs.readFileSync(distIndexPath, 'utf-8');
      res
        .status(200)
        .type('text/html; charset=utf-8')
        .send(injectPublicOriginIntoHtml(rawHtml, _req));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Pirate Academy 3D server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Pirate Academy server:', err);
  process.exit(1);
});
