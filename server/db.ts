/**
 * Server-side Persistent Store & Authoritative Quiz/Session Engine
 * Persists packages, student sessions, sync logs, dashboard activities,
 * and teacher settings to data/db.json.
 * Created by Deni Raja99
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  ChestMapping,
  DashboardActivity,
  Question,
  QuestionPackage,
  StudentAnswer,
  StudentSession,
  SyncOperationLog,
  TeacherSettings,
} from '../src/types/game.ts';
import {
  ADVENTURE_PATH_WAYPOINTS,
  getDistributedChestsForQuestions,
} from '../src/game/ChestConfig.ts';
import { normalizeTrueFalseValue } from '../src/teacher/questionValidation.ts';

export const CHEST_PRESETS = ADVENTURE_PATH_WAYPOINTS.map((wp) => ({
  name: wp.name,
  zoneType: wp.zoneType,
  x: wp.x,
  y: wp.y,
  z: wp.z,
  interactionRadius: wp.interactionRadius,
}));

export interface DatabaseState {
  packages: QuestionPackage[];
  sessions: StudentSession[];
  settings: TeacherSettings;
  syncLogs: SyncOperationLog[];
  activities: DashboardActivity[];
  lastUpdatedAt: string;
}

const IS_VERCEL_RUNTIME = Boolean(process.env.VERCEL);
const SEED_DATA_DIR = path.resolve(process.cwd(), 'data');
const SEED_DB_FILE = path.join(SEED_DATA_DIR, 'db.json');
const DATA_DIR = IS_VERCEL_RUNTIME
  ? path.join(os.tmpdir(), 'pirate-academy-data')
  : SEED_DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_QUESTION_EXPLANATIONS: Record<
  string,
  { explanation: string; correctExplanation?: string; incorrectExplanation?: string }
> = {
  'q-default-1': {
    explanation: 'Total jarak tempuh dihitung dengan menjumlahkan kedua jarak: 15 km + 25 km = 40 km.',
    correctExplanation: 'Tepat! 15 km + 25 km = 40 km.',
    incorrectExplanation: 'Total jarak diperoleh dengan menjumlahkan 15 km dan 25 km, hasilnya adalah 40 km (B).',
  },
  'q-default-2': {
    explanation: 'Kompas memiliki jarum bermagnet yang selalu mengarah ke kutub utara dan selatan bumi sehingga membantu pelaut bernavigasi.',
    correctExplanation: 'Benar! Jarum magnet pada kompas pelaut menunjuk arah utara-selatan.',
    incorrectExplanation: 'Alat navigasi yang memakai jarum magnetik untuk menentukan arah mata angin adalah kompas pelaut (C).',
  },
  'q-default-3': {
    explanation: 'Alga dan fitoplankton memiliki klorofil untuk berfotosintesis menghasilkan makanan dan oksigen sebagai produsen di laut.',
    correctExplanation: 'Hebat! Alga dan fitoplankton melakukan fotosintesis untuk menghasilkan oksigen di laut.',
    incorrectExplanation: 'Hiu, bintang laut, dan penyu adalah konsumen. Produsen laut yang menghasilkan oksigen dengan sinar matahari adalah alga dan fitoplankton (B).',
  },
  'q-default-4': {
    explanation: 'Angin yang bertiup mendorong layar kain kapal layar sehingga menghasilkan gaya dorong yang menggerakkan kapal maju di atas air.',
  },
  'q-default-5': {
    explanation: 'Pembagian rata: 48 koin ÷ 6 orang = 8 koin untuk setiap anak buah kapal (karena 6 × 8 = 48).',
    correctExplanation: 'Tepat sekali! 48 ÷ 6 = 8 koin emas per orang.',
    incorrectExplanation: 'Untuk membagi rata 48 koin ke 6 orang, hitung 48 ÷ 6 = 8 koin (C).',
  },
  'q-default-6': {
    explanation: 'Gotong royong adalah nilai luhur bangsa Indonesia berupa kerja sama dan saling membantu demi kepentingan bersama.',
  },
  'q-default-7': {
    explanation: 'Sampah plastik di laut sulit terurai dan dapat termakan atau melilit penyu, ikan, serta merusak terumbu karang.',
  },
};

function createDefaultPackages(): QuestionPackage[] {
  const pkgId = 'pkg-default-sd-1';
  const now = new Date().toISOString();
  const questions: Question[] = [
    {
      id: 'q-default-1',
      number: 1,
      type: 'multiple_choice',
      prompt: 'Kapten Bajak Laut berlayar sejauh 15 km pada jam pertama dan 25 km pada jam kedua. Berapakah total jarak yang telah ditempuh kapal?',
      options: [
        { id: 'A', text: '35 km' },
        { id: 'B', text: '40 km' },
        { id: 'C', text: '45 km' },
        { id: 'D', text: '50 km' },
      ],
      correctAnswer: 'B',
      ...DEFAULT_QUESTION_EXPLANATIONS['q-default-1'],
      points: 10,
      isActive: true,
      chestPosition: CHEST_PRESETS[0],
      locationName: CHEST_PRESETS[0].name,
      sourceMeta: { sourceType: 'manual', confidence: 'high' },
    },
    {
      id: 'q-default-2',
      number: 2,
      type: 'multiple_choice',
      prompt: 'Alat navigasi kuno yang menggunakan jarum magnetik untuk menunjukkan arah utara, selatan, timur, dan barat disebut...',
      options: [
        { id: 'A', text: 'Teleskop bintang' },
        { id: 'B', text: 'Termometer air' },
        { id: 'C', text: 'Kompas pelaut' },
        { id: 'D', text: 'Jam matahari' },
      ],
      correctAnswer: 'C',
      ...DEFAULT_QUESTION_EXPLANATIONS['q-default-2'],
      points: 10,
      isActive: true,
      chestPosition: CHEST_PRESETS[1],
      locationName: CHEST_PRESETS[1].name,
      sourceMeta: { sourceType: 'manual', confidence: 'high' },
    },
    {
      id: 'q-default-3',
      number: 3,
      type: 'multiple_choice',
      prompt: 'Di ekosistem terumbu karang pulau tropis, kelompok organisme manakah yang berperan sebagai produsen utama yang menghasilkan oksigen dengan bantuan sinar matahari?',
      options: [
        { id: 'A', text: 'Ikan hiu martil' },
        { id: 'B', text: 'Alga dan fitoplankton' },
        { id: 'C', text: 'Bintang laut berduri' },
        { id: 'D', text: 'Penyu sisik' },
      ],
      correctAnswer: 'B',
      ...DEFAULT_QUESTION_EXPLANATIONS['q-default-3'],
      points: 10,
      isActive: true,
      chestPosition: CHEST_PRESETS[2],
      locationName: CHEST_PRESETS[2].name,
      sourceMeta: { sourceType: 'manual', confidence: 'high' },
    },
    {
      id: 'q-default-4',
      number: 4,
      type: 'short_answer',
      prompt: 'Sebutkan gaya yang menggerakkan kapal layar kayu di lautan ketika layarnya terbentang tertiup angin!',
      keywords: ['gaya angin', 'angin', 'dorong angin', 'aerodinamis'],
      ...DEFAULT_QUESTION_EXPLANATIONS['q-default-4'],
      points: 15,
      isActive: true,
      chestPosition: CHEST_PRESETS[3],
      locationName: CHEST_PRESETS[3].name,
      sourceMeta: { sourceType: 'manual', confidence: 'high' },
    },
    {
      id: 'q-default-5',
      number: 5,
      type: 'multiple_choice',
      prompt: 'Satu peti harta berisi 48 koin emas murni. Jika koin tersebut dibagi rata kepada 6 anak buah kapal yang jujur, berapa koin yang diterima setiap orang?',
      options: [
        { id: 'A', text: '6 koin' },
        { id: 'B', text: '7 koin' },
        { id: 'C', text: '8 koin' },
        { id: 'D', text: '9 koin' },
      ],
      correctAnswer: 'C',
      ...DEFAULT_QUESTION_EXPLANATIONS['q-default-5'],
      points: 10,
      isActive: true,
      chestPosition: CHEST_PRESETS[4],
      locationName: CHEST_PRESETS[4].name,
      sourceMeta: { sourceType: 'manual', confidence: 'high' },
    },
    {
      id: 'q-default-6',
      number: 6,
      type: 'short_answer',
      prompt: 'Apa istilah sikap saling membantu dan bekerja bersama tanpa pamrih yang menjadi nilai luhur Pancasila di Indonesia?',
      keywords: ['gotong royong', 'kerja sama', 'tolong menolong'],
      ...DEFAULT_QUESTION_EXPLANATIONS['q-default-6'],
      points: 15,
      isActive: true,
      chestPosition: CHEST_PRESETS[5],
      locationName: CHEST_PRESETS[5].name,
      sourceMeta: { sourceType: 'manual', confidence: 'high' },
    },
    {
      id: 'q-default-7',
      number: 7,
      type: 'essay',
      prompt: 'Tuliskan secara singkat mengapa kita harus menjaga kebersihan pantai dan laut dari sampah plastik bagi kelangsungan hidup biota laut!',
      essayRubric: 'Memuat penjelasan bahaya sampah plastik bagi hewan laut (termakan, terlilit) dan pentingnya melestarikan ekosistem laut.',
      ...DEFAULT_QUESTION_EXPLANATIONS['q-default-7'],
      points: 30,
      isActive: true,
      chestPosition: CHEST_PRESETS[6],
      locationName: CHEST_PRESETS[6].name,
      sourceMeta: { sourceType: 'manual', confidence: 'high' },
    },
  ];

  const pkg: QuestionPackage = {
    id: pkgId,
    version: 1,
    title: 'Misi Harta Karun Samudra Tropis',
    description: 'Paket contoh awal untuk siswa SD. Guru dapat mengimpor soal dari PDF, Word, atau Google Drive di Portal Guru.',
    gradeLevel: 'Kelas 4 - 6 SD',
    timeLimitMinutes: 0,
    isSequential: false,
    showInstantFeedback: true,
    createdAt: now,
    updatedAt: now,
    publishedAt: now,
    status: 'published',
    isPublished: true,
    sourceType: 'manual',
    lastSyncStatus: 'ready',
    questions,
  };
  pkg.chestMappings = buildChestMappings(pkg);
  return [pkg];
}

export function buildChestMappings(pkg: QuestionPackage): ChestMapping[] {
  const activeQuestions = (pkg.questions || []).filter((q) => q.isActive !== false);
  const count = activeQuestions.length;
  if (count === 0) return [];
  const distributed = getDistributedChestsForQuestions(count);

  return activeQuestions.map((q, idx) => {
    const wp = distributed[idx] || distributed[distributed.length - 1];
    const locationName =
      count > ADVENTURE_PATH_WAYPOINTS.length ? `Pos #${idx + 1} (${wp.name})` : wp.name;

    return {
      chestId: `chest-${String(idx + 1).padStart(2, '0')}`,
      chestNumber: idx + 1,
      questionId: q.id,
      quizId: pkg.id,
      locationName,
      zoneType: wp.zoneType,
      position: { x: wp.x, y: wp.y, z: wp.z },
      interactionRadius: wp.interactionRadius,
      active: true,
    };
  });
}

export function deduplicateQuestions(questions: Question[]): {
  questions: Question[];
  changed: boolean;
} {
  const seenIds = new Set<string>();
  let changed = false;

  const normalized = questions.map((q, idx) => {
    let nextId = (q.id || '').trim() || `q-${Date.now()}-${idx + 1}`;
    if (seenIds.has(nextId)) {
      changed = true;
      let suffix = idx + 1;
      while (seenIds.has(`${nextId}-${suffix}`)) {
        suffix++;
      }
      nextId = `${nextId}-${suffix}`;
    }
    seenIds.add(nextId);

    const nextNumber = idx + 1;
    if (q.number !== nextNumber) {
      changed = true;
    }

    let nextOptions = q.options;
    if (Array.isArray(q.options)) {
      const seenOptIds = new Set<string>();
      const filteredOpts = q.options.filter((opt) => {
        if (seenOptIds.has(opt.id)) {
          changed = true;
          return false;
        }
        seenOptIds.add(opt.id);
        return true;
      });
      nextOptions = filteredOpts;
    }

    const nextIsActive = q.isActive !== false;
    if (q.isActive === undefined) {
      changed = true;
    }

    return {
      ...q,
      id: nextId,
      number: nextNumber,
      isActive: nextIsActive,
      options: nextOptions,
    };
  });

  return { questions: normalized, changed };
}

let dbState: DatabaseState | null = null;
const teacherTokens = new Map<string, number>();

const DISALLOWED_WEAK_PINS = new Set([
  'guru123',
  '1234',
  '12345',
  '123456',
  '0000',
  '000000',
  '111111',
  'admin',
  'admin123',
  'password',
]);

function sha256Buffer(value: string): Buffer {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = sha256Buffer(a);
  const bufB = sha256Buffer(b);
  return crypto.timingSafeEqual(bufA, bufB);
}

export function hashTeacherPin(pin: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(pin, salt, 64);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

export function verifyTeacherPinHash(pin: string, storedHash: string): boolean {
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hashHex] = parts;
  if (!salt || !hashHex) return false;
  try {
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(pin, salt, expected.length);
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function validateTeacherPinPolicy(rawPin: unknown): {
  valid: boolean;
  pin?: string;
  message?: string;
} {
  if (typeof rawPin !== 'string') {
    return { valid: false, message: 'PIN guru wajib berupa teks.' };
  }
  const trimmed = rawPin.trim();
  if (trimmed.length < 6) {
    return {
      valid: false,
      message: 'PIN guru minimal 6 karakter demi keamanan Portal Guru.',
    };
  }
  if (trimmed.length > 64) {
    return {
      valid: false,
      message: 'PIN guru maksimal 64 karakter.',
    };
  }
  if (DISALLOWED_WEAK_PINS.has(trimmed.toLowerCase())) {
    return {
      valid: false,
      message: 'PIN terlalu umum atau merupakan default lama. Gunakan kombinasi PIN yang kuat dan unik.',
    };
  }
  return { valid: true, pin: trimmed };
}

export interface TeacherAuthStatus {
  pinConfigured: boolean;
  requiresInitialSetup: boolean;
  setupSecretConfigured: boolean;
  setupSecretConsumed: boolean;
  pinManagedByEnv: boolean;
}

export function getTeacherAuthStatus(): TeacherAuthStatus {
  const db = loadDatabase();
  const envPin = (process.env.TEACHER_PIN || '').trim();
  const envPinHash = (process.env.TEACHER_PIN_HASH || '').trim();
  const envPinConfigured = Boolean(envPin || envPinHash);
  const dbPinConfigured = Boolean(db.settings.pinHash);
  const pinConfigured = envPinConfigured || dbPinConfigured;

  const setupSecret = (process.env.TEACHER_SETUP_SECRET || '').trim();
  const setupDigest = setupSecret ? sha256Hex(setupSecret) : '';
  const consumedList = Array.isArray(db.settings.consumedSetupSecretDigests)
    ? db.settings.consumedSetupSecretDigests
    : [];
  const setupSecretConsumed = Boolean(setupDigest && consumedList.includes(setupDigest));
  const setupSecretConfigured = Boolean(setupSecret) && !setupSecretConsumed && !pinConfigured;

  return {
    pinConfigured,
    requiresInitialSetup: !pinConfigured,
    setupSecretConfigured,
    setupSecretConsumed,
    pinManagedByEnv: envPinConfigured,
  };
}

export function verifyTeacherLoginPin(candidatePin: string): boolean {
  const trimmed = candidatePin.trim();
  if (!trimmed) return false;

  const envPin = (process.env.TEACHER_PIN || '').trim();
  if (envPin) {
    return constantTimeEqual(trimmed, envPin);
  }

  const envPinHash = (process.env.TEACHER_PIN_HASH || '').trim();
  if (envPinHash) {
    return verifyTeacherPinHash(trimmed, envPinHash);
  }

  const db = loadDatabase();
  if (!db.settings.pinHash) {
    return false;
  }
  return verifyTeacherPinHash(trimmed, db.settings.pinHash);
}

export function setupInitialTeacherPinWithSecret(
  setupSecretInput: string,
  newPinInput: string
): {
  success: boolean;
  status: number;
  message: string;
} {
  const authStatus = getTeacherAuthStatus();
  if (authStatus.pinConfigured) {
    return {
      success: false,
      status: 403,
      message:
        'PIN guru sudah dikonfigurasi. Setup awal otomatis dikunci; gunakan PIN yang sudah ada untuk masuk atau mengubah PIN di Pengaturan.',
    };
  }

  const configuredSecret = (process.env.TEACHER_SETUP_SECRET || '').trim();
  if (!configuredSecret) {
    return {
      success: false,
      status: 503,
      message:
        'Secret setup awal (TEACHER_SETUP_SECRET) belum diatur pada environment server. Konfigurasikan TEACHER_SETUP_SECRET atau TEACHER_PIN di Secrets server terlebih dahulu.',
    };
  }

  const db = loadDatabase();
  const secretDigest = sha256Hex(configuredSecret);
  const consumed = Array.isArray(db.settings.consumedSetupSecretDigests)
    ? db.settings.consumedSetupSecretDigests
    : [];

  if (consumed.includes(secretDigest) || db.settings.setupSecretConsumedAt) {
    return {
      success: false,
      status: 403,
      message:
        'Secret setup awal ini sudah pernah digunakan dan dinonaktifkan. Rotasi TEACHER_SETUP_SECRET di server jika perlu setup ulang.',
    };
  }

  if (!setupSecretInput.trim() || !constantTimeEqual(setupSecretInput.trim(), configuredSecret)) {
    return {
      success: false,
      status: 401,
      message: 'Secret setup awal tidak valid.',
    };
  }

  const pinPolicy = validateTeacherPinPolicy(newPinInput);
  if (!pinPolicy.valid || !pinPolicy.pin) {
    return {
      success: false,
      status: 400,
      message: pinPolicy.message || 'PIN tidak memenuhi syarat.',
    };
  }

  const now = new Date().toISOString();
  db.settings.pinHash = hashTeacherPin(pinPolicy.pin);
  delete db.settings.pin;
  db.settings.pinSetupCompletedAt = now;
  db.settings.pinUpdatedAt = now;
  db.settings.setupSecretConsumedAt = now;
  db.settings.consumedSetupSecretDigests = [...consumed, secretDigest];
  saveDatabase();

  recordDashboardActivity({
    category: 'settings',
    status: 'success',
    title: 'PIN Awal Portal Guru Ditetapkan',
    detail: 'PIN guru disimpan terenkripsi (scrypt hash) dan secret setup satu kali telah dinonaktifkan.',
  });

  return {
    success: true,
    status: 200,
    message: 'PIN Portal Guru berhasil ditetapkan secara aman. Silakan login menggunakan PIN baru Anda.',
  };
}

export function updateTeacherPinSecurely(newPinInput: string): {
  success: boolean;
  message: string;
} {
  if ((process.env.TEACHER_PIN || '').trim() || (process.env.TEACHER_PIN_HASH || '').trim()) {
    return {
      success: false,
      message:
        'PIN saat ini dikelola melalui Secret server (TEACHER_PIN). Ubah variabel environment TEACHER_PIN di dashboard hosting Anda.',
    };
  }

  const policy = validateTeacherPinPolicy(newPinInput);
  if (!policy.valid || !policy.pin) {
    return {
      success: false,
      message: policy.message || 'PIN baru tidak valid.',
    };
  }

  const db = loadDatabase();
  db.settings.pinHash = hashTeacherPin(policy.pin);
  delete db.settings.pin;
  db.settings.pinUpdatedAt = new Date().toISOString();
  saveDatabase();

  return {
    success: true,
    message: 'PIN Portal Guru berhasil diperbarui (tersimpan sebagai hash scrypt).',
  };
}

const EPHEMERAL_TOKEN_FALLBACK_KEY = crypto.randomBytes(32).toString('hex');

function getTeacherTokenSigningKey(): string {
  const envSecret = (
    process.env.TEACHER_AUTH_SECRET ||
    process.env.TEACHER_PIN ||
    process.env.TEACHER_PIN_HASH ||
    process.env.TEACHER_SETUP_SECRET ||
    ''
  ).trim();
  if (envSecret) {
    return `pa3d-hmac:${sha256Hex(envSecret)}`;
  }
  const db = loadDatabase();
  if (db.settings.pinHash) {
    return `pa3d-hmac:${sha256Hex(db.settings.pinHash)}`;
  }
  return EPHEMERAL_TOKEN_FALLBACK_KEY;
}

export function issueTeacherToken(): string {
  const expiresAt = Date.now() + 1000 * 60 * 60 * 12; // 12 hours
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = `v1.${expiresAt}.${nonce}`;
  const sig = crypto
    .createHmac('sha256', getTeacherTokenSigningKey())
    .update(payload)
    .digest('hex');
  const token = `${payload}.${sig}`;
  teacherTokens.set(token, expiresAt);
  return token;
}

export function validateTeacherToken(token: string | undefined): boolean {
  if (!token) return false;
  const trimmed = token.trim();
  const parts = trimmed.split('.');
  if (parts.length === 4 && parts[0] === 'v1') {
    const expiresAt = Number(parts[1]);
    const nonce = parts[2];
    const sigHex = parts[3];
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt || !nonce || !sigHex) {
      return false;
    }
    try {
      const payload = `v1.${parts[1]}.${nonce}`;
      const expectedHex = crypto
        .createHmac('sha256', getTeacherTokenSigningKey())
        .update(payload)
        .digest('hex');
      const expectedBuf = Buffer.from(expectedHex, 'hex');
      const actualBuf = Buffer.from(sigHex, 'hex');
      if (expectedBuf.length !== actualBuf.length) return false;
      return crypto.timingSafeEqual(expectedBuf, actualBuf);
    } catch {
      return false;
    }
  }

  const expiry = teacherTokens.get(trimmed);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    teacherTokens.delete(trimmed);
    return false;
  }
  return true;
}

export function loadDatabase(): DatabaseState {
  if (dbState) return dbState;

  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const sourceFile = fs.existsSync(DB_FILE)
      ? DB_FILE
      : fs.existsSync(SEED_DB_FILE)
      ? SEED_DB_FILE
      : null;

    if (sourceFile) {
      const raw = fs.readFileSync(sourceFile, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<DatabaseState>;
      if (parsed && Array.isArray(parsed.packages) && Array.isArray(parsed.sessions) && parsed.settings) {
        let repaired = sourceFile !== DB_FILE;
        if (!Array.isArray(parsed.syncLogs)) {
          parsed.syncLogs = [];
          repaired = true;
        }
        if (!Array.isArray(parsed.activities)) {
          parsed.activities = [];
          repaired = true;
        }

        // Security migration: strip plaintext legacy 'pin' field; never preserve default 'guru123'
        if (typeof parsed.settings.pin === 'string') {
          const legacyPin = parsed.settings.pin.trim();
          if (!parsed.settings.pinHash && legacyPin && legacyPin !== 'guru123') {
            parsed.settings.pinHash = hashTeacherPin(legacyPin);
            parsed.settings.pinUpdatedAt = new Date().toISOString();
          }
          delete parsed.settings.pin;
          repaired = true;
        }

        parsed.packages = parsed.packages.map((pkg) => {
          let { questions: cleanQuestions, changed } = deduplicateQuestions(pkg.questions || []);

          if (pkg.id === 'pkg-default-sd-1') {
            cleanQuestions = cleanQuestions.map((q) => {
              const defExp = DEFAULT_QUESTION_EXPLANATIONS[q.id];
              if (defExp && !q.explanation) {
                changed = true;
                return {
                  ...q,
                  explanation: defExp.explanation,
                  correctExplanation: q.correctExplanation || defExp.correctExplanation,
                  incorrectExplanation: q.incorrectExplanation || defExp.incorrectExplanation,
                };
              }
              return q;
            });
          }

          const tempPkg = { ...pkg, questions: cleanQuestions };
          const freshMappings = buildChestMappings(tempPkg);
          const mappingsOutOfSync =
            !Array.isArray(pkg.chestMappings) ||
            pkg.chestMappings.length !== freshMappings.length ||
            pkg.chestMappings.some((m, i) => {
              const f = freshMappings[i];
              return (
                !f ||
                m.questionId !== f.questionId ||
                m.zoneType !== f.zoneType ||
                m.locationName !== f.locationName ||
                Math.abs((m.position?.x ?? 9999) - (f.position?.x ?? 0)) > 0.1 ||
                Math.abs((m.position?.z ?? 9999) - (f.position?.z ?? 0)) > 0.1
              );
            });

          if (changed || mappingsOutOfSync) {
            repaired = true;
            const mappingByQuestionId = new Map(freshMappings.map((m) => [m.questionId, m]));
            const updatedPkg = { ...tempPkg, chestMappings: freshMappings };
            updatedPkg.questions = cleanQuestions.map((q) => {
              const mp = mappingByQuestionId.get(q.id);
              return mp
                ? {
                    ...q,
                    chestPosition: mp.position,
                    locationName: mp.locationName,
                    zoneType: mp.zoneType,
                  }
                : q;
            });
            return updatedPkg;
          }
          return pkg;
        });

        dbState = {
          packages: parsed.packages,
          sessions: parsed.sessions,
          settings: parsed.settings,
          syncLogs: parsed.syncLogs,
          activities: parsed.activities,
          lastUpdatedAt: parsed.lastUpdatedAt || new Date().toISOString(),
        };
        if (repaired) {
          saveDatabase();
        }
        return dbState;
      }
    }
  } catch (err) {
    console.warn('Warning loading db.json, initializing fresh state:', err);
  }

  const defaultPackages = createDefaultPackages();
  dbState = {
    packages: defaultPackages,
    sessions: [],
    settings: {
      googleSheetsWebAppUrl: process.env.GOOGLE_SHEETS_WEBAPP_URL || '',
      spreadsheetIdOrUrl: '',
      autoSyncSheets: true,
      activePackageId: defaultPackages[0].id,
    },
    syncLogs: [],
    activities: [
      {
        id: `act-${Date.now()}`,
        timestamp: new Date().toISOString(),
        category: 'sync',
        status: 'info',
        title: 'Paket Awal Siap',
        detail: `Paket "${defaultPackages[0].title}" aktif dengan ${defaultPackages[0].questions.length} peti soal.`,
      },
    ],
    lastUpdatedAt: new Date().toISOString(),
  };
  saveDatabase();
  return dbState;
}

export function saveDatabase(): void {
  if (!dbState) return;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    dbState.lastUpdatedAt = new Date().toISOString();
    fs.writeFileSync(DB_FILE, JSON.stringify(dbState, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to persist db.json:', err);
  }
}

export function recordSyncLog(entry: SyncOperationLog): void {
  const db = loadDatabase();
  const idx = db.syncLogs.findIndex((l) => l.id === entry.id);
  if (idx >= 0) {
    db.syncLogs[idx] = entry;
  } else {
    db.syncLogs.unshift(entry);
  }
  if (db.syncLogs.length > 60) {
    db.syncLogs = db.syncLogs.slice(0, 60);
  }
  saveDatabase();
}

export function recordDashboardActivity(
  activity: Omit<DashboardActivity, 'id' | 'timestamp'>
): DashboardActivity {
  const db = loadDatabase();
  const created: DashboardActivity = {
    id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    ...activity,
  };
  db.activities.unshift(created);
  if (db.activities.length > 60) {
    db.activities = db.activities.slice(0, 60);
  }
  saveDatabase();
  return created;
}

/**
 * Returns the currently active published package ready for the 3D game,
 * filtering out inactive questions and mapping chests strictly 1:1.
 */
export function getActivePublishedPackage(): QuestionPackage | null {
  const db = loadDatabase();
  const active = db.packages.find((p) => p.id === db.settings.activePackageId && p.isPublished);
  if (!active) return null;

  const activeQuestions = (active.questions || [])
    .filter((q) => q.isActive !== false)
    .map((q, idx) => ({ ...q, number: idx + 1 }));

  if (activeQuestions.length === 0) return null;

  const activeCopy: QuestionPackage = {
    ...active,
    questions: activeQuestions,
  };
  const freshMappings = buildChestMappings(activeCopy);
  const mapByQ = new Map(freshMappings.map((m) => [m.questionId, m]));

  activeCopy.chestMappings = freshMappings;
  activeCopy.questions = activeQuestions.map((q) => {
    const mp = mapByQ.get(q.id);
    return mp
      ? {
          ...q,
          chestPosition: mp.position,
          locationName: mp.locationName,
          zoneType: mp.zoneType,
        }
      : q;
  });

  return activeCopy;
}

function parseComplexLetters(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return Array.from(
          new Set(parsed.map((v) => String(v).trim().toUpperCase()).filter(Boolean))
        ).sort();
      }
    } catch {
      // fall through to delimiter split
    }
  }
  return Array.from(
    new Set(
      trimmed
        .split(/[\s,;\/&+]+/)
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z]$/.test(s))
    )
  ).sort();
}

function normalizeShortText(val: string): string {
  return val.trim().replace(/\s+/g, ' ').toLowerCase();
}

function parseStrictNumeric(val: string): number | null {
  const cleaned = val.trim().replace(/\s+/g, '');
  if (!cleaned) return null;
  // Support Indonesian decimal comma like "3,5" when unambiguously numeric
  const normalized = /^-?\d+,\d+$/.test(cleaned) ? cleaned.replace(',', '.') : cleaned;
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function parseMatchingStudentMap(raw: string): Map<string, string> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    const result = new Map<string, string>();
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && typeof item === 'object') {
          const leftKey = String((item as { id?: string; left?: string }).id ?? (item as { left?: string }).left ?? '').trim();
          const rightVal = String((item as { right?: string }).right ?? '').trim();
          if (leftKey) result.set(leftKey, rightVal);
        }
      }
      return result;
    }
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        result.set(String(k).trim(), String(v ?? '').trim());
      }
      return result;
    }
  } catch {
    return null;
  }
  return null;
}

export function formatCorrectAnswerSnapshot(question: Question): string | undefined {
  if (question.type === 'multiple_choice') {
    return question.correctAnswer;
  }
  if (question.type === 'multiple_choice_complex') {
    const list =
      Array.isArray(question.correctAnswers) && question.correctAnswers.length > 0
        ? question.correctAnswers
        : question.correctAnswer
        ? parseComplexLetters(question.correctAnswer)
        : [];
    return list.length > 0 ? list.join(', ') : undefined;
  }
  if (question.type === 'true_false') {
    const tf =
      typeof question.correctBoolean === 'boolean'
        ? question.correctBoolean
        : normalizeTrueFalseValue(question.correctAnswer);
    if (tf === null) return undefined;
    return tf ? 'Benar' : 'Salah';
  }
  if (question.type === 'matching') {
    if (!Array.isArray(question.matchingPairs) || question.matchingPairs.length === 0) {
      return question.correctAnswer;
    }
    return question.matchingPairs.map((p) => `${p.left} -> ${p.right}`).join(' | ');
  }
  if (question.type === 'short_answer') {
    const list =
      Array.isArray(question.acceptedAnswers) && question.acceptedAnswers.length > 0
        ? question.acceptedAnswers
        : Array.isArray(question.keywords)
        ? question.keywords
        : [];
    return list.length > 0 ? list.join(' / ') : question.correctAnswer;
  }
  if (question.type === 'essay') {
    return question.essayRubric || undefined;
  }
  return question.correctAnswer;
}

export function gradeAnswerServerSide(
  question: Question,
  answerText: string
): {
  isCorrect: boolean | undefined;
  scoreAwarded: number;
  gradingStatus: 'graded' | 'pending_review';
} {
  const trimmed = answerText.trim();

  if (question.type === 'multiple_choice') {
    if (!question.correctAnswer) {
      return {
        isCorrect: undefined,
        scoreAwarded: 0,
        gradingStatus: 'pending_review',
      };
    }
    const isCorrect = trimmed.toUpperCase() === question.correctAnswer.trim().toUpperCase();
    return {
      isCorrect,
      scoreAwarded: isCorrect ? question.points : 0,
      gradingStatus: 'graded',
    };
  }

  if (question.type === 'multiple_choice_complex') {
    const keyList =
      Array.isArray(question.correctAnswers) && question.correctAnswers.length > 0
        ? Array.from(new Set(question.correctAnswers.map((k) => k.trim().toUpperCase()).filter(Boolean))).sort()
        : question.correctAnswer
        ? parseComplexLetters(question.correctAnswer)
        : [];
    if (keyList.length === 0) {
      return {
        isCorrect: undefined,
        scoreAwarded: 0,
        gradingStatus: 'pending_review',
      };
    }
    const studentList = parseComplexLetters(trimmed);
    const isCorrect =
      studentList.length === keyList.length &&
      keyList.every((k, idx) => studentList[idx] === k);
    return {
      isCorrect,
      scoreAwarded: isCorrect ? question.points : 0,
      gradingStatus: 'graded',
    };
  }

  if (question.type === 'true_false') {
    const keyBool =
      typeof question.correctBoolean === 'boolean'
        ? question.correctBoolean
        : normalizeTrueFalseValue(question.correctAnswer);
    if (keyBool === null) {
      return {
        isCorrect: undefined,
        scoreAwarded: 0,
        gradingStatus: 'pending_review',
      };
    }
    const studentBool = normalizeTrueFalseValue(trimmed);
    if (studentBool === null) {
      return {
        isCorrect: false,
        scoreAwarded: 0,
        gradingStatus: 'graded',
      };
    }
    const isCorrect = studentBool === keyBool;
    return {
      isCorrect,
      scoreAwarded: isCorrect ? question.points : 0,
      gradingStatus: 'graded',
    };
  }

  if (question.type === 'matching') {
    const pairs = Array.isArray(question.matchingPairs) ? question.matchingPairs : [];
    if (pairs.length < 2 || pairs.some((p) => !p.left.trim() || !p.right.trim())) {
      return {
        isCorrect: undefined,
        scoreAwarded: 0,
        gradingStatus: 'pending_review',
      };
    }
    const studentMap = parseMatchingStudentMap(trimmed);
    if (!studentMap) {
      return {
        isCorrect: false,
        scoreAwarded: 0,
        gradingStatus: 'graded',
      };
    }
    const isCorrect = pairs.every((pair) => {
      const candidate =
        studentMap.get(pair.id) ??
        studentMap.get(pair.left) ??
        studentMap.get(pair.left.trim());
      if (!candidate) return false;
      return normalizeShortText(candidate) === normalizeShortText(pair.right);
    });
    return {
      isCorrect,
      scoreAwarded: isCorrect ? question.points : 0,
      gradingStatus: 'graded',
    };
  }

  if (question.type === 'short_answer') {
    const accepted = Array.isArray(question.acceptedAnswers)
      ? question.acceptedAnswers.map((s) => s.trim()).filter(Boolean)
      : [];
    if (accepted.length > 0) {
      const studentNorm = normalizeShortText(trimmed);
      const studentNum = parseStrictNumeric(trimmed);
      const isCorrect = accepted.some((ans) => {
        if (normalizeShortText(ans) === studentNorm) return true;
        if (studentNum !== null) {
          const ansNum = parseStrictNumeric(ans);
          if (ansNum !== null && Math.abs(ansNum - studentNum) < 1e-9) return true;
        }
        return false;
      });
      return {
        isCorrect,
        scoreAwarded: isCorrect ? question.points : 0,
        gradingStatus: 'graded',
      };
    }

    if (question.keywords && question.keywords.length > 0) {
      const lower = trimmed.toLowerCase();
      const isCorrect = question.keywords.some((kw) => kw.trim() && lower.includes(kw.trim().toLowerCase()));
      return {
        isCorrect,
        scoreAwarded: isCorrect ? question.points : 0,
        gradingStatus: 'graded',
      };
    }
    return {
      isCorrect: undefined,
      scoreAwarded: 0,
      gradingStatus: 'pending_review',
    };
  }

  return {
    isCorrect: undefined,
    scoreAwarded: 0,
    gradingStatus: 'pending_review',
  };
}

export function recalculateSessionTotals(session: StudentSession): StudentSession {
  const answerList = Object.values(session.answers || {});
  let totalScore = 0;
  const completedSet = new Set<string>();

  for (const ans of answerList) {
    totalScore += Number(ans.scoreAwarded) || 0;
    if (ans.questionId) {
      completedSet.add(ans.questionId);
    }
  }

  session.chestsCompleted = Array.from(completedSet);
  session.totalScore = totalScore;
  session.percentageScore =
    session.maxPossibleScore > 0
      ? Math.round((totalScore / session.maxPossibleScore) * 100)
      : 0;
  session.updatedAt = new Date().toISOString();
  return session;
}

export function upsertAnswerInSession(
  session: StudentSession,
  question: Question,
  answerText: string,
  chestId?: string,
  durationSeconds?: number
): { session: StudentSession; answer: StudentAnswer; alreadySubmitted: boolean } {
  const existing = session.answers?.[question.id];
  if (existing) {
    recalculateSessionTotals(session);
    return { session, answer: existing, alreadySubmitted: true };
  }

  const resultId = `${session.sessionId}::${question.id}`;
  const graded = gradeAnswerServerSide(question, answerText);

  const answerRecord: StudentAnswer = {
    resultId,
    quizId: session.packageId,
    chestId:
      chestId ||
      session.chestMappings?.find((m) => m.questionId === question.id)?.chestId ||
      `chest-${String(question.number).padStart(2, '0')}`,
    questionId: question.id,
    questionNumber: question.number,
    questionType: question.type,
    questionPrompt: question.prompt,
    correctAnswerSnapshot: formatCorrectAnswerSnapshot(question),
    answerText: answerText.trim(),
    isCorrect: graded.isCorrect,
    gradingStatus: graded.gradingStatus,
    scoreAwarded: graded.scoreAwarded,
    maxPoints: question.points,
    answeredAt: new Date().toISOString(),
    durationSeconds: typeof durationSeconds === 'number' ? Math.max(0, Math.round(durationSeconds)) : undefined,
  };

  session.answers[question.id] = answerRecord;
  recalculateSessionTotals(session);
  return { session, answer: answerRecord, alreadySubmitted: false };
}
