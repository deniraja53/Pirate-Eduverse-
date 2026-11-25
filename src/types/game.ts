/**
 * Types for Pirate Academy: Treasure Quest
 * Created by Deni Raja99
 */

export type QuestionType =
  | 'multiple_choice'
  | 'multiple_choice_complex'
  | 'true_false'
  | 'matching'
  | 'short_answer'
  | 'essay';

export const ALL_QUESTION_TYPES: QuestionType[] = [
  'multiple_choice',
  'multiple_choice_complex',
  'true_false',
  'matching',
  'short_answer',
  'essay',
];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  multiple_choice: 'Pilihan Ganda',
  multiple_choice_complex: 'Pilihan Ganda Kompleks',
  true_false: 'Benar / Salah',
  matching: 'Menjodohkan',
  short_answer: 'Isian Singkat',
  essay: 'Uraian / Esai',
};

export function getQuestionTypeLabel(type?: string): string {
  if (!type) return 'Soal Peti';
  return QUESTION_TYPE_LABELS[type as QuestionType] || 'Soal Peti';
}

export interface QuestionOption {
  id: string; // 'A' | 'B' | 'C' | 'D' | 'E' | ...
  text: string;
}

export interface MatchingPair {
  id: string; // '1', '2', '3', ...
  left: string;
  right: string;
}

export type AnswerSource =
  | 'pdf_answer_key'
  | 'pdf_inline_key'
  | 'word_answer_key'
  | 'ocr_answer_key'
  | 'drive_answer_key'
  | 'manual'
  | 'none';

export type AnswerStatus = 'verified' | 'needs_review' | 'manual_only';

export interface QuestionSourceMeta {
  page?: number;
  confidence?: 'high' | 'medium' | 'needs_review';
  sourceType?: 'pdf_text' | 'ocr' | 'word_docx' | 'word_doc' | 'drive' | 'manual';
  rawSnippet?: string;
  sectionLabel?: string;
}

export type ChestZoneType = 'main_path' | 'roadside' | 'forest_edge' | 'exploration_area';

export interface ChestPlacementMeta {
  valid: boolean;
  position: { x: number; y: number; z: number };
  zoneType: ChestZoneType;
  groundMeshName: string;
  slopeNormalY: number;
  obstacleClearanceOk: boolean;
  nearestPropDistance: number | null;
  reachableFromPath: boolean;
  adjusted: boolean;
  reason: string;
}

export const ALLOWED_STUDENT_GRADES = ['Kelas 4', 'Kelas 5', 'Kelas 6'] as const;
export type AllowedStudentGrade = (typeof ALLOWED_STUDENT_GRADES)[number];

export const STUDENT_GRADE_OPTIONS: Array<{ value: AllowedStudentGrade; label: string }> = [
  { value: 'Kelas 4', label: 'Kelas IV (4)' },
  { value: 'Kelas 5', label: 'Kelas V (5)' },
  { value: 'Kelas 6', label: 'Kelas VI (6)' },
];

export function normalizeAllowedGrade(rawGrade?: string): AllowedStudentGrade | null {
  if (!rawGrade || typeof rawGrade !== 'string') return null;
  const cleaned = rawGrade
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!cleaned) return null;

  if (
    cleaned === 'kelas 4' ||
    cleaned === 'kelas iv' ||
    cleaned === 'kelas iv (4)' ||
    cleaned === 'kelas 4 sd' ||
    cleaned === '4' ||
    cleaned === 'iv'
  ) {
    return 'Kelas 4';
  }
  if (
    cleaned === 'kelas 5' ||
    cleaned === 'kelas v' ||
    cleaned === 'kelas v (5)' ||
    cleaned === 'kelas 5 sd' ||
    cleaned === '5' ||
    cleaned === 'v'
  ) {
    return 'Kelas 5';
  }
  if (
    cleaned === 'kelas 6' ||
    cleaned === 'kelas vi' ||
    cleaned === 'kelas vi (6)' ||
    cleaned === 'kelas 6 sd' ||
    cleaned === '6' ||
    cleaned === 'vi'
  ) {
    return 'Kelas 6';
  }
  return null;
}

export type PackageSyncStatus =
  | 'draft'
  | 'needs_fix'
  | 'ready'
  | 'pending_sync'
  | 'syncing'
  | 'synced'
  | 'failed';

export interface Question {
  id: string;
  number: number; // Sequential 1..N index inside package / 3D chests
  questionNumber?: number; // Original declared number from imported document (e.g. 1..40)
  type: QuestionType;
  prompt: string;
  instructions?: string; // Instruksi khusus terkait soal
  options?: QuestionOption[]; // For multiple_choice & multiple_choice_complex
  correctAnswer?: string; // Single canonical answer (PG letter 'A'..'E', or 'Benar'/'Salah' for true_false)
  correctAnswers?: string[]; // Multiple canonical option IDs for multiple_choice_complex (e.g. ['A', 'B', 'D'])
  correctBoolean?: boolean; // Canonical boolean for true_false
  acceptedAnswers?: string[]; // Canonical accepted text/numeric answers for short_answer
  keywords?: string[]; // Backward-compatible short answer keywords
  matchingPairs?: MatchingPair[]; // Canonical left-right pairs for matching
  essayRubric?: string; // Teacher grading criteria for essay
  explanation?: string; // Pembahasan / penjelasan edukatif soal (dari dokumen atau Guru)
  correctExplanation?: string; // Penjelasan spesifik saat jawaban benar (opsional)
  incorrectExplanation?: string; // Penjelasan spesifik saat jawaban salah (opsional)
  points: number; // Score weight
  needsReview?: boolean; // True when key missing, ambiguous, or duplicate number
  answerSource?: AnswerSource;
  answerStatus?: AnswerStatus;
  validationErrors?: string[];
  isActive?: boolean; // Default true; inactive questions stay in bank but excluded from active 3D chests
  imageUrl?: string; // Uploaded local image URL (/api/question-images/...) or valid HTTPS URL
  imageAlt?: string; // Deskripsi gambar soal (alt text)
  imagePosition?: 'before' | 'after'; // Penempatan gambar: sebelum atau sesudah teks soal
  updatedAt?: string;
  sourceMeta?: QuestionSourceMeta;
  chestPosition?: { x: number; y: number; z: number };
  locationName?: string;
  zoneType?: ChestZoneType;
}

export interface ChestMapping {
  chestId: string;
  chestNumber: number;
  questionId: string;
  quizId: string;
  locationName: string;
  zoneType?: ChestZoneType;
  position?: { x: number; y: number; z: number };
  interactionRadius?: number;
  active?: boolean;
}

export interface QuestionPackage {
  id: string; // quizId
  version?: number;
  title: string;
  description: string;
  gradeLevel: string; // e.g. "Kelas 4", "Kelas 5", "Kelas 6"
  timeLimitMinutes?: number; // 0 for unlimited
  isSequential: boolean; // Must finish chest in order or free roam
  showInstantFeedback: boolean; // Show correct/wrong immediately
  createdAt: string;
  updatedAt?: string;
  publishedAt?: string;
  status?: 'draft' | 'published';
  isPublished: boolean;
  sourceType?: 'pdf' | 'word' | 'drive' | 'manual';
  sourceFileName?: string;
  sourceFileSizeBytes?: number;
  sourcePdfName?: string;
  sourcePdfSizeBytes?: number;
  lastSyncedAt?: string;
  lastSyncStatus?: PackageSyncStatus;
  lastSyncError?: string;
  lastOperationId?: string;
  lastSyncDurationMs?: number;
  clientRequestId?: string;
  chestMappings?: ChestMapping[];
  questions: Question[];
}

export interface StudentInfo {
  studentId?: string;
  name: string;
  grade: string;
  schoolName?: string;
  avatarId?: string;
}

export type GradingStatus = 'graded' | 'pending_review';

export interface StudentAnswer {
  resultId?: string; // Unique idempotency key: `${sessionId}::${questionId}`
  quizId?: string;
  chestId?: string;
  questionId: string;
  questionNumber: number;
  questionType: QuestionType;
  questionPrompt?: string;
  correctAnswerSnapshot?: string;
  answerText: string;
  isCorrect?: boolean;
  gradingStatus?: GradingStatus;
  scoreAwarded: number;
  maxPoints: number;
  answeredAt: string;
  durationSeconds?: number;
  teacherFeedback?: string;
  isGradedManually?: boolean;
  gradedBy?: string;
  gradedAt?: string;
}

export type SheetsSyncStatus = 'idle' | 'syncing' | 'synced' | 'failed';

export interface SavedPlayerPose {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  cameraYaw?: number;
  cameraPitch?: number;
  updatedAt: string;
}

export interface StudentSession {
  sessionId: string;
  student: StudentInfo;
  packageId: string; // quizId
  packageVersion?: number;
  packageTitle: string;
  startTime: string;
  endTime?: string;
  updatedAt?: string;
  isCompleted: boolean;
  totalScore: number;
  maxPossibleScore: number;
  percentageScore: number;
  chestMappings?: ChestMapping[];
  answers: Record<string, StudentAnswer>; // questionId -> StudentAnswer
  chestsCompleted: string[]; // questionId array
  lastPosition?: SavedPlayerPose;
  syncedToSheets: boolean;
  sheetsSyncStatus?: SheetsSyncStatus;
  sheetsSyncError?: string;
  lastSyncedAt?: string;
}

export interface ChestState {
  id: string;
  questionNumber: number;
  question: Question;
  position: [number, number, number];
  locationName: string;
  status: 'locked' | 'available' | 'completed';
  openedAnimationProgress: number; // 0 to 1
}

export interface TeacherSettings {
  pin?: string;
  pinHash?: string;
  pinUpdatedAt?: string;
  pinSetupCompletedAt?: string;
  setupSecretConsumedAt?: string;
  consumedSetupSecretDigests?: string[];
  googleSheetsWebAppUrl: string;
  spreadsheetIdOrUrl?: string;
  sheetsSharedSecret?: string;
  autoSyncSheets: boolean;
  activePackageId: string;
  sheetsLastSyncAt?: string;
  sheetsLastError?: string;
  mapGlbUrl?: string;
  characterGlbUrl?: string;
}

export interface PublicTeacherConfig {
  googleSheetsConfigured: boolean;
  autoSyncSheets: boolean;
  activePackageId: string;
}

export interface SyncOperationLog {
  id: string;
  operationType:
    | 'sync_game'
    | 'sync_sheets_bank'
    | 'sync_sheets_session'
    | 'test_sheets_connection'
    | 'import_pdf'
    | 'import_word'
    | 'import_drive';
  target: 'game_3d' | 'google_sheets' | 'both' | 'bank_soal';
  packageId?: string;
  packageTitle?: string;
  status: 'running' | 'success' | 'failed';
  itemCount: number;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  message: string;
  verifiedReadBack?: boolean;
}

export interface DashboardActivity {
  id: string;
  timestamp: string;
  category: 'import' | 'edit' | 'sync' | 'sheets' | 'grading' | 'settings';
  status: 'success' | 'warning' | 'error' | 'info';
  title: string;
  detail: string;
}

export interface ImportExtractionSummary {
  totalExtracted: number;
  byType: Record<QuestionType, number>;
  matchedKeysCount: number;
  needsReviewCount: number;
  blockingErrorCount: number;
  duplicateNumbers: number[];
  missingNumbers: number[];
  hasAnswerKeySection: boolean;
}

export interface ImportExtractionResult {
  success: boolean;
  sourceMethod: 'pdf' | 'word' | 'drive';
  fileName: string;
  fileSizeBytes: number;
  pageCount: number;
  isScanned: boolean;
  ocrAvailable: boolean;
  ocrUsed?: boolean;
  embeddedImageCount?: number;
  recognizedCount: number;
  needsReviewCount: number;
  rawText: string;
  questions: Question[];
  warnings: string[];
  summary?: ImportExtractionSummary;
  message: string;
  requestId?: string;
}

// Keep backward compatible alias
export type PdfExtractionResult = ImportExtractionResult;
