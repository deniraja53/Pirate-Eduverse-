/**
 * Unified Full-Stack Express + WebSocket + Vite Server for Pirate Academy 3D
 * Handles PDF upload/extraction (<= 2MB), authoritative grading, real-time WS updates,
 * Google Sheets backend sync, and Vite dev/production serving on port 3000.
 * Created by Deni Raja99
 */

import 'dotenv/config';
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
  issueTeacherToken,
  loadDatabase,
  recalculateSessionTotals,
  saveDatabase,
  upsertAnswerInSession,
  validateTeacherToken,
} from './server/db.ts';
import {
  MAX_PDF_BYTES,
  processPdfUpload,
  runOcrOnPdfBuffer,
} from './server/pdfExtractor.ts';
import {
  syncPackageToSheets,
  syncSessionNow,
  testAppsScriptConnection,
} from './server/sheetsSync.ts';
import {
  normalizeAllowedGrade,
  type Question,
  type QuestionPackage,
  type StudentSession,
} from './src/types/game.ts';

const PORT = 3000;
const app = express();
const server = http.createServer(app);

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

// Multer configuration with strict 2 MB limit
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_PDF_BYTES,
    files: 1,
  },
});

function handleSinglePdfUpload(req: Request, res: Response, next: NextFunction) {
  pdfUpload.single('file')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({
          success: false,
          message: 'Ukuran file melebihi batas maksimum 2 MB (2.097.152 byte). Unggahan ditolak.',
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
}

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

app.get('/api/quiz/active', (_req, res) => {
  const active = getActivePublishedPackage();
  if (!active) {
    res.status(404).json({
      success: false,
      activePackage: null,
      message:
        'Belum ada paket soal aktif yang diterbitkan oleh guru. Silakan hubungi guru untuk menerbitkan paket soal di Portal Guru.',
    });
    return;
  }
  res.json({
    success: true,
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

    // Trigger real-time background sync to Google Sheets if configured & autoSync enabled
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

app.post('/api/teacher/login', (req, res) => {
  const { pin } = req.body as { pin?: string };
  const db = loadDatabase();
  const validPin = db.settings.pin || 'guru123';

  if (!pin || pin !== validPin) {
    res.status(401).json({
      success: false,
      message: 'PIN salah! Silakan masukkan PIN guru yang valid.',
    });
    return;
  }

  const token = issueTeacherToken();
  res.json({
    success: true,
    token,
    message: 'Autentikasi Portal Guru berhasil.',
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

  // Normalize questions preserving unique IDs and assigning chest coordinates
  const rawNormalized: Question[] = pkgInput.questions.map((q, idx) => {
    const preset = CHEST_PRESETS[idx % CHEST_PRESETS.length];
    return {
      ...q,
      id: q.id || `q-${Date.now()}-${idx + 1}`,
      number: idx + 1,
      points: Math.max(1, Number(q.points) || 10),
      chestPosition: q.chestPosition || preset,
      locationName: q.locationName || preset.name,
    };
  });
  const { questions: normalizedQuestions } = deduplicateQuestions(rawNormalized);

  const existingIdx = pkgInput.id ? db.packages.findIndex((p) => p.id === pkgInput.id) : -1;

  let savedPkg: QuestionPackage;
  if (existingIdx >= 0) {
    const existing = db.packages[existingIdx];
    savedPkg = {
      ...existing,
      ...pkgInput,
      id: existing.id,
      questions: normalizedQuestions,
      updatedAt: now,
    };
    savedPkg.chestMappings = buildChestMappings(savedPkg);
    db.packages[existingIdx] = savedPkg;
  } else {
    const newId = pkgInput.id || `quiz-${Date.now()}`;
    savedPkg = {
      id: newId,
      version: 1,
      title: pkgInput.title.trim(),
      description: (pkgInput.description || 'Paket soal hasil ekstraksi Portal Guru').trim(),
      gradeLevel: pkgInput.gradeLevel || 'Semua Kelas SD',
      timeLimitMinutes: pkgInput.timeLimitMinutes || 0,
      isSequential: Boolean(pkgInput.isSequential),
      showInstantFeedback: pkgInput.showInstantFeedback !== false,
      createdAt: now,
      updatedAt: now,
      status: 'draft',
      isPublished: false,
      sourcePdfName: pkgInput.sourcePdfName,
      sourcePdfSizeBytes: pkgInput.sourcePdfSizeBytes,
      questions: normalizedQuestions,
    };
    newId;
    savedPkg.chestMappings = buildChestMappings(savedPkg);
    db.packages.unshift(savedPkg);
  }

  saveDatabase();
  res.json({
    success: true,
    package: savedPkg,
    message: 'Draf paket soal berhasil disimpan.',
  });
});

app.post('/api/teacher/packages/:id/publish', requireTeacherAuth, async (req, res) => {
  const { id } = req.params;
  const { createNewVersion } = (req.body || {}) as { createNewVersion?: boolean };
  const db = loadDatabase();
  const target = db.packages.find((p) => p.id === id);

  if (!target) {
    res.status(404).json({ success: false, message: 'Paket soal tidak ditemukan.' });
    return;
  }
  if (!target.questions || target.questions.length === 0) {
    res.status(400).json({
      success: false,
      message: 'Paket soal masih kosong. Tambahkan atau ekstrak minimal 1 soal sebelum menerbitkan.',
    });
    return;
  }

  const now = new Date().toISOString();
  let publishedPkg: QuestionPackage;

  if (createNewVersion && target.isPublished) {
    // Create a fresh quizId version so prior quiz results stay traceable!
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

  // Notify connected clients via WebSocket immediately
  broadcastWs('quiz:published', publishedPkg);

  // Sync BankSoal to Google Sheets if configured
  let sheetsSyncResult: { success: boolean; message: string } | null = null;
  if (db.settings.googleSheetsWebAppUrl && db.settings.autoSyncSheets) {
    sheetsSyncResult = await syncPackageToSheets(publishedPkg);
  }

  res.json({
    success: true,
    package: publishedPkg,
    activePackageId: db.settings.activePackageId,
    sheetsSyncResult,
    message: `Paket "${publishedPkg.title}" berhasil diterbitkan (${publishedPkg.questions.length} peti aktif)!`,
  });
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
  db.packages = db.packages.filter((p) => p.id !== targetId);
  if (db.settings.activePackageId === targetId) {
    const nextPublished = db.packages.find((p) => p.isPublished);
    db.settings.activePackageId = nextPublished ? nextPublished.id : '';
  }
  saveDatabase();
  res.json({
    success: true,
    packages: db.packages,
    activePackageId: db.settings.activePackageId,
  });
});

// PDF Upload & Extraction (2 MB backend enforced)
app.post('/api/teacher/pdf/upload', requireTeacherAuth, handleSinglePdfUpload, async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({
        success: false,
        message: 'Tidak ada file PDF yang diterima server.',
      });
      return;
    }

    const result = await processPdfUpload(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err instanceof Error ? err.message : 'Gagal mengekstrak file PDF.',
    });
  }
});

// Explicit OCR endpoint for scanned PDFs
app.post('/api/teacher/pdf/ocr', requireTeacherAuth, handleSinglePdfUpload, async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({
        success: false,
        message: 'Tidak ada file PDF yang dikirim untuk OCR.',
      });
      return;
    }

    const result = await runOcrOnPdfBuffer(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err instanceof Error ? err.message : 'Gagal memproses OCR PDF.',
    });
  }
});

// Student Results Recap & Manual Grading
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

// Teacher Settings & Google Sheets Test
app.get('/api/teacher/settings', requireTeacherAuth, (_req, res) => {
  const db = loadDatabase();
  res.json({
    success: true,
    settings: {
      googleSheetsWebAppUrl: db.settings.googleSheetsWebAppUrl,
      autoSyncSheets: db.settings.autoSyncSheets,
      activePackageId: db.settings.activePackageId,
      pinConfigured: Boolean(db.settings.pin),
    },
  });
});

app.put('/api/teacher/settings', requireTeacherAuth, (req, res) => {
  const { googleSheetsWebAppUrl, autoSyncSheets, activePackageId, newPin } = req.body as {
    googleSheetsWebAppUrl?: string;
    autoSyncSheets?: boolean;
    activePackageId?: string;
    newPin?: string;
  };
  const db = loadDatabase();

  if (typeof googleSheetsWebAppUrl === 'string') {
    db.settings.googleSheetsWebAppUrl = googleSheetsWebAppUrl.trim();
  }
  if (typeof autoSyncSheets === 'boolean') {
    db.settings.autoSyncSheets = autoSyncSheets;
  }
  if (typeof activePackageId === 'string') {
    db.settings.activePackageId = activePackageId;
    const activePkg = getActivePublishedPackage();
    if (activePkg) broadcastWs('quiz:published', activePkg);
  }
  if (typeof newPin === 'string' && newPin.trim().length >= 4) {
    db.settings.pin = newPin.trim();
  }

  saveDatabase();
  res.json({
    success: true,
    settings: {
      googleSheetsWebAppUrl: db.settings.googleSheetsWebAppUrl,
      autoSyncSheets: db.settings.autoSyncSheets,
      activePackageId: db.settings.activePackageId,
      pinConfigured: true,
    },
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

// ========================
// VITE / STATIC SERVING
// ========================

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
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
