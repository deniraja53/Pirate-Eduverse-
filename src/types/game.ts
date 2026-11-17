/**
 * Types for Pirate Academy: Treasure Quest
 * Created by Deni Raja99
 */

export type QuestionType = 'multiple_choice' | 'short_answer' | 'essay';

export interface QuestionOption {
  id: string; // 'A' | 'B' | 'C' | 'D'
  text: string;
}

export interface QuestionSourceMeta {
  page?: number;
  confidence?: 'high' | 'medium' | 'needs_review';
  sourceType?: 'pdf_text' | 'ocr' | 'manual';
  rawSnippet?: string;
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

export interface Question {
  id: string;
  number: number;
  type: QuestionType;
  prompt: string;
  instructions?: string; // Instruksi khusus terkait soal
  options?: QuestionOption[]; // For multiple choice
  correctAnswer?: string; // Undefined if not explicitly present in PDF
  keywords?: string[]; // For short answer auto-checking / guidance
  essayRubric?: string; // Teacher grading criteria for essay
  explanation?: string; // Pembahasan / penjelasan edukatif soal (dari PDF atau Guru)
  correctExplanation?: string; // Penjelasan spesifik saat jawaban benar (opsional)
  incorrectExplanation?: string; // Penjelasan spesifik saat jawaban salah (opsional)
  points: number; // Score weight
  needsReview?: boolean; // True when key missing or parser low-confidence
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
  sourcePdfName?: string;
  sourcePdfSizeBytes?: number;
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

export interface StudentSession {
  sessionId: string;
  student: StudentInfo;
  packageId: string; // quizId
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
  pin: string;
  googleSheetsWebAppUrl: string;
  autoSyncSheets: boolean;
  activePackageId: string;
  mapGlbUrl?: string;
  characterGlbUrl?: string;
}

export interface PublicTeacherConfig {
  googleSheetsConfigured: boolean;
  autoSyncSheets: boolean;
  activePackageId: string;
}

export interface PdfExtractionResult {
  success: boolean;
  fileName: string;
  fileSizeBytes: number;
  pageCount: number;
  isScanned: boolean;
  ocrAvailable: boolean;
  ocrUsed?: boolean;
  rawText: string;
  questions: Question[];
  warnings: string[];
  message: string;
}
