/**
 * Teacher Portal Dashboard for Pirate Academy 3D (V11 Pixel Art Retro Edition)
 * Color System: Ungu Gelap (#170d29), Ungu Cerah (#7c3aed), Kuning Emas (#facc15), Pink (#ec4899)
 * 8 Complete Menus:
 *   1. Dashboard            (Live stats, 9-step workflow status, recent activities, shortcuts)
 *   2. Bank Soal            (Packages, status badges, chest 3D mappings, create/delete/switch)
 *   3. Impor Soal           (PDF <= 2MB + OCR, Word .docx/.doc <= 2MB, Google Drive + Picker)
 *   4. Editor dan Pratinjau (Full CRUD, image upload/alt/pos, active toggle, validation, preview)
 *   5. Sinkronisasi Game    (Strict validation gate, read-back verification, opId/duration, cache note)
 *   6. Google Sheets        (Status, masked Spreadsheet ID, test connection, copy Code.gs, guide, logs)
 *   7. Rekap Nilai          (Live WS results, filters, sort, CSV export, manual scoring modal)
 *   8. Pengaturan Integrasi (Web App URL, Spreadsheet URL/ID, shared token, Drive OAuth, PIN)
 * Created by Deni Raja99
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  CloudUpload,
  Copy,
  Database,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  FileUp,
  HelpCircle,
  Key,
  Layers,
  LayoutDashboard,
  MapPin,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  Search,
  Settings,
  Shield,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  ALL_QUESTION_TYPES,
  getQuestionTypeLabel,
  type DashboardActivity,
  type PackageSyncStatus,
  type Question,
  type QuestionPackage,
  type StudentSession,
  type SyncOperationLog,
} from '../types/game';
import { CHEST_PRESETS } from '../services/storage';
import { CHEST_ZONE_LABELS } from '../game/ChestConfig';
import { GOOGLE_APPS_SCRIPT_CODE, testSheetsConnection } from '../services/sheetsApi';
import {
  connectRealtimeWs,
  deleteTeacherPackageApi,
  fetchTeacherAuthStatusApi,
  fetchTeacherOverviewApi,
  fetchTeacherPackagesApi,
  fetchTeacherSessionsApi,
  fetchTeacherSettingsApi,
  getTeacherToken,
  loginTeacherApi,
  publishTeacherPackageApi,
  retrySessionSheetsSyncApi,
  saveTeacherPackageApi,
  setTeacherToken,
  setupInitialTeacherPinApi,
  syncPackageToSheetsApi,
  updateTeacherSettingsApi,
  type TeacherAuthStatusDto,
  type TeacherSettingsDto,
} from '../services/apiClient';
import {
  getCachedDriveAccessToken,
  getGoogleDriveConfigStatus,
  initGoogleDriveAuth,
  signInGoogleDrive,
  signOutGoogleDrive,
} from '../services/googleDriveAuth';
import { QuestionImporter } from './QuestionImporter';
import { QuestionEditorPanel } from './QuestionEditorPanel';
import { PixelConfirmModal } from './QuestionPreviewModal';
import { GoogleSheetsGuideModal } from './GoogleSheetsGuideModal';
import { ManualScoringModal } from './ManualScoringModal';
import { validatePackageForSync } from './questionValidation';
import { sounds } from '../services/audio';

interface TeacherDashboardProps {
  onBackToGame: () => void;
}

type PortalMenu =
  | 'dashboard'
  | 'bank'
  | 'import'
  | 'editor'
  | 'sync'
  | 'sheets'
  | 'recap'
  | 'settings';

function getPackageStatusBadge(
  pkg: QuestionPackage,
  activePackageId: string
): { label: string; className: string } {
  const val = validatePackageForSync(pkg);
  if (!val.valid) {
    return {
      label: 'Perlu diperbaiki',
      className: 'bg-red-950 border-[#ef4444] text-[#fca5a5]',
    };
  }
  if (pkg.lastSyncStatus === 'syncing') {
    return {
      label: 'Sedang disinkronkan',
      className: 'bg-purple-950 border-[#a855f7] text-[#e9d5ff]',
    };
  }
  if (pkg.lastSyncStatus === 'failed') {
    return {
      label: 'Gagal disinkronkan',
      className: 'bg-red-950 border-[#ef4444] text-[#fca5a5]',
    };
  }
  if (pkg.id === activePackageId && pkg.isPublished) {
    if (pkg.lastSyncStatus === 'pending_sync') {
      return {
        label: 'Menunggu sinkronisasi',
        className: 'bg-amber-950 border-[#facc15] text-[#facc15]',
      };
    }
    return {
      label: 'Tersinkronisasi (Aktif di Game)',
      className: 'bg-emerald-950 border-[#22c55e] text-[#86efac]',
    };
  }
  if (pkg.isPublished) {
    return {
      label: 'Siap diterbitkan',
      className: 'bg-indigo-950 border-[#818cf8] text-[#c7d2fe]',
    };
  }
  if (val.valid) {
    return {
      label: 'Siap diterbitkan (Draf)',
      className: 'bg-[#281647] border-[#f472b6] text-[#f9a8d4]',
    };
  }
  return {
    label: 'Draf',
    className: 'bg-[#1b102d] border-[#6d28d9] text-[#cbb7eb]',
  };
}

export const TeacherDashboard: React.FC<TeacherDashboardProps> = ({ onBackToGame }) => {
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(Boolean(getTeacherToken()));
  const [authStatus, setAuthStatus] = useState<TeacherAuthStatusDto | null>(null);
  const [authStatusError, setAuthStatusError] = useState('');
  const [isLoadingAuthStatus, setIsLoadingAuthStatus] = useState<boolean>(!getTeacherToken());
  const [enteredPin, setEnteredPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Initial PIN setup state (admin-secret-gated)
  const [setupSecretInput, setSetupSecretInput] = useState('');
  const [setupPinInput, setSetupPinInput] = useState('');
  const [setupPinConfirmInput, setSetupPinConfirmInput] = useState('');
  const [setupError, setSetupError] = useState('');
  const [setupSuccessMessage, setSetupSuccessMessage] = useState('');
  const [isSubmittingSetup, setIsSubmittingSetup] = useState(false);

  // Core data state
  const [packages, setPackages] = useState<QuestionPackage[]>([]);
  const [activePackageId, setActivePackageId] = useState<string>('');
  const [selectedPkgId, setSelectedPkgId] = useState<string>('');
  const [sessions, setSessions] = useState<StudentSession[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncOperationLog[]>([]);
  const [activities, setActivities] = useState<DashboardActivity[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string>('');
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [bannerNotice, setBannerNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Settings state
  const [settingsDto, setSettingsDto] = useState<TeacherSettingsDto | null>(null);
  const [googleSheetsWebAppUrl, setGoogleSheetsWebAppUrl] = useState('');
  const [spreadsheetIdOrUrl, setSpreadsheetIdOrUrl] = useState('');
  const [sheetsSharedSecretInput, setSheetsSharedSecretInput] = useState('');
  const [autoSyncSheets, setAutoSyncSheets] = useState(true);
  const [newPinInput, setNewPinInput] = useState('');

  // Drive OAuth state (for Settings & Dashboard)
  const driveConfig = getGoogleDriveConfigStatus();
  const [driveConnectedEmail, setDriveConnectedEmail] = useState<string | null>(null);
  const [hasDriveToken, setHasDriveToken] = useState<boolean>(() => Boolean(getCachedDriveAccessToken()));

  // Navigation (8 Menus)
  const [currentMenu, setCurrentMenu] = useState<PortalMenu>('dashboard');

  // Sync Tab Controls
  const [isSyncingGame, setIsSyncingGame] = useState(false);
  const [createNewVersionOnSync, setCreateNewVersionOnSync] = useState(false);
  const [forceResyncChecked, setForceResyncChecked] = useState(false);
  const [lastSyncRunResult, setLastSyncRunResult] = useState<{
    success: boolean;
    operationId?: string;
    durationMs?: number;
    verifiedReadBack?: boolean;
    message: string;
    sheetsMessage?: string;
  } | null>(null);

  // Sheets & Guide Modals
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isTestingSheets, setIsTestingSheets] = useState(false);
  const [isSyncingSheetsPkg, setIsSyncingSheetsPkg] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [confirmDeletePkgId, setConfirmDeletePkgId] = useState<string | null>(null);

  // Recap Filters & Modals
  const [detailSession, setDetailSession] = useState<StudentSession | null>(null);
  const [gradingModalData, setGradingModalData] = useState<{
    session: StudentSession;
    question: Question;
  } | null>(null);
  const [retryingSessionId, setRetryingSessionId] = useState<string | null>(null);
  const [filterGrade, setFilterGrade] = useState('Semua');
  const [filterQuizId, setFilterQuizId] = useState('Semua');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'time_desc' | 'time_asc' | 'score_desc' | 'score_asc'>('time_desc');

  useEffect(() => {
    const unsub = initGoogleDriveAuth(
      (user, token) => {
        setDriveConnectedEmail(user.email || user.displayName || 'Akun Google');
        setHasDriveToken(Boolean(token));
      },
      () => {
        setDriveConnectedEmail(null);
        setHasDriveToken(false);
      }
    );
    return unsub;
  }, []);

  const loadAllTeacherData = useCallback(async () => {
    if (!getTeacherToken()) {
      setIsAuthenticated(false);
      return;
    }
    setIsLoadingData(true);
    try {
      const [pkgRes, sesRes, setRes, ovRes] = await Promise.all([
        fetchTeacherPackagesApi(),
        fetchTeacherSessionsApi(),
        fetchTeacherSettingsApi(),
        fetchTeacherOverviewApi(),
      ]);

      if (pkgRes.status === 401 || sesRes.status === 401) {
        setTeacherToken('');
        setIsAuthenticated(false);
        return;
      }

      if (pkgRes.success) {
        setPackages(pkgRes.packages);
        setActivePackageId(pkgRes.activePackageId);
        setSelectedPkgId((prev) =>
          prev && pkgRes.packages.some((p) => p.id === prev)
            ? prev
            : pkgRes.activePackageId || pkgRes.packages[0]?.id || ''
        );
      }

      if (sesRes.success) {
        setSessions(sesRes.sessions);
        setLastUpdatedAt(sesRes.lastUpdatedAt || new Date().toISOString());
      }

      if (setRes.success && setRes.settings) {
        setSettingsDto(setRes.settings);
        setGoogleSheetsWebAppUrl(setRes.settings.googleSheetsWebAppUrl || '');
        setSpreadsheetIdOrUrl(setRes.settings.spreadsheetIdOrUrl || '');
        setAutoSyncSheets(setRes.settings.autoSyncSheets);
      }

      if (ovRes.success) {
        setSyncLogs(ovRes.syncLogs);
        setActivities(ovRes.activities);
      }
    } finally {
      setIsLoadingData(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      void loadAllTeacherData();
    }
  }, [isAuthenticated, loadAllTeacherData]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const disconnect = connectRealtimeWs((evt) => {
      if (evt.type === 'session:updated') {
        const updated = evt.payload;
        setSessions((prev) => {
          const exists = prev.some((s) => s.sessionId === updated.sessionId);
          return exists
            ? prev.map((s) => (s.sessionId === updated.sessionId ? updated : s))
            : [updated, ...prev];
        });
        setDetailSession((prev) =>
          prev && prev.sessionId === updated.sessionId ? updated : prev
        );
        setLastUpdatedAt(new Date().toISOString());
      } else if (evt.type === 'sheets:sync_status') {
        const st = evt.payload;
        setSessions((prev) =>
          prev.map((s) =>
            s.sessionId === st.sessionId
              ? {
                  ...s,
                  sheetsSyncStatus: st.status,
                  syncedToSheets: st.syncedToSheets,
                  lastSyncedAt: st.lastSyncedAt || s.lastSyncedAt,
                  sheetsSyncError: st.error,
                }
              : s
          )
        );
        setLastUpdatedAt(new Date().toISOString());
      } else if (evt.type === 'quiz:published') {
        const pub = evt.payload;
        setActivePackageId(pub.id);
        setLastUpdatedAt(new Date().toISOString());
      }
    });
    return disconnect;
  }, [isAuthenticated]);

  const refreshAuthStatus = useCallback(async () => {
    setIsLoadingAuthStatus(true);
    setAuthStatusError('');
    try {
      const res = await fetchTeacherAuthStatusApi();
      if (res.success && res.authStatus) {
        setAuthStatus(res.authStatus);
      } else {
        setAuthStatus(null);
        setAuthStatusError(
          res.message || 'Gagal memeriksa status autentikasi Portal Guru dari server API.'
        );
      }
    } catch {
      setAuthStatus(null);
      setAuthStatusError('Tidak dapat terhubung ke server API Portal Guru.');
    } finally {
      setIsLoadingAuthStatus(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      void refreshAuthStatus();
    }
  }, [isAuthenticated, refreshAuthStatus]);

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoggingIn || !enteredPin.trim()) return;
    setIsLoggingIn(true);
    setPinError('');
    setSetupSuccessMessage('');

    try {
      const res = await loginTeacherApi(enteredPin.trim());
      if (res.success) {
        setIsAuthenticated(true);
        setEnteredPin('');
        sounds.playClick();
      } else {
        setPinError(res.message || 'PIN salah! Silakan coba lagi.');
        if (res.requiresInitialSetup) {
          void refreshAuthStatus();
        }
        sounds.playWrong();
      }
    } catch {
      setPinError('Gagal terhubung ke server autentikasi.');
      sounds.playWrong();
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleInitialSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingSetup) return;

    const cleanSecret = setupSecretInput.trim();
    const cleanPin = setupPinInput.trim();
    const cleanConfirm = setupPinConfirmInput.trim();

    if (!cleanSecret) {
      setSetupError('Masukkan Secret Setup Server (TEACHER_SETUP_SECRET).');
      return;
    }
    if (cleanPin.length < 6) {
      setSetupError('PIN Guru baru minimal 6 karakter.');
      return;
    }
    if (cleanPin !== cleanConfirm) {
      setSetupError('Konfirmasi PIN Guru tidak cocok.');
      return;
    }

    setIsSubmittingSetup(true);
    setSetupError('');

    try {
      const res = await setupInitialTeacherPinApi(cleanSecret, cleanPin);
      if (res.success) {
        setSetupSecretInput('');
        setSetupPinInput('');
        setSetupPinConfirmInput('');
        setSetupSuccessMessage(
          res.message || 'PIN Portal Guru berhasil ditetapkan! Silakan masuk menggunakan PIN baru Anda.'
        );
        if (res.authStatus) {
          setAuthStatus(res.authStatus);
        } else {
          await refreshAuthStatus();
        }
        sounds.playCorrect();
      } else {
        setSetupError(res.message || 'Gagal menetapkan PIN awal Portal Guru.');
        if (res.authStatus) {
          setAuthStatus(res.authStatus);
        }
        sounds.playWrong();
      }
    } catch {
      setSetupError('Gagal terhubung ke server untuk setup PIN awal.');
      sounds.playWrong();
    } finally {
      setIsSubmittingSetup(false);
    }
  };

  const selectedPackage = useMemo(
    () => packages.find((p) => p.id === selectedPkgId) || packages[0] || null,
    [packages, selectedPkgId]
  );

  const selectedPkgValidation = useMemo(
    () => (selectedPackage ? validatePackageForSync(selectedPackage) : null),
    [selectedPackage]
  );

  // Dashboard Live Metrics
  const dashboardStats = useMemo(() => {
    let totalSavedQuestions = 0;
    let totalValidationErrors = 0;
    let unsyncedCount = 0;

    packages.forEach((p) => {
      totalSavedQuestions += (p.questions || []).length;
      const val = validatePackageForSync(p);
      totalValidationErrors += val.errorCount;
      if (p.id === activePackageId && p.lastSyncStatus === 'pending_sync') {
        unsyncedCount += val.activeCount;
      } else if (p.id !== activePackageId && !p.isPublished) {
        unsyncedCount += val.activeCount;
      }
    });

    const activePkg = packages.find((p) => p.id === activePackageId && p.isPublished);
    const activeQuestionsCount = activePkg
      ? (activePkg.questions || []).filter((q) => q.isActive !== false).length
      : 0;

    const lastSyncTs =
      syncLogs.find((l) => l.status === 'success')?.finishedAt ||
      settingsDto?.sheetsLastSyncAt ||
      activePkg?.lastSyncedAt ||
      '';

    return {
      totalPackages: packages.length,
      totalSavedQuestions,
      activeQuestionsCount,
      unsyncedCount,
      totalValidationErrors,
      lastSyncTs,
      sheetsConfigured: Boolean(settingsDto?.googleSheetsWebAppUrl),
      sheetsLastError: settingsDto?.sheetsLastError || '',
      studentSessionsCount: sessions.length,
    };
  }, [packages, activePackageId, syncLogs, settingsDto, sessions.length]);

  const handleCreateEmptyDraft = async () => {
    const res = await saveTeacherPackageApi({
      title: `Paket Kuis Baru (${new Date().toLocaleDateString('id-ID')})`,
      description: 'Paket kuis baru dibuat manual di Portal Guru.',
      gradeLevel: 'Kelas 5 SD',
      isSequential: false,
      showInstantFeedback: true,
      sourceType: 'manual',
      questions: [
        {
          id: `q-new-${Date.now()}-1`,
          number: 1,
          type: 'multiple_choice',
          prompt: 'Tuliskan pertanyaan pertama Anda di sini...',
          options: [
            { id: 'A', text: 'Pilihan A' },
            { id: 'B', text: 'Pilihan B' },
            { id: 'C', text: 'Pilihan C' },
            { id: 'D', text: 'Pilihan D' },
          ],
          correctAnswer: 'A',
          points: 10,
          isActive: true,
          chestPosition: CHEST_PRESETS[0],
          locationName: CHEST_PRESETS[0].name,
        },
      ],
    });
    if (res.success && res.package) {
      await loadAllTeacherData();
      setSelectedPkgId(res.package.id);
      setCurrentMenu('editor');
      setBannerNotice({
        type: 'success',
        text: 'Draf paket kuis baru dibuat dan dibuka di Editor & Pratinjau.',
      });
      sounds.playClick();
    }
  };

  const handleConfirmDeletePackage = async () => {
    if (!confirmDeletePkgId) return;
    const targetId = confirmDeletePkgId;
    setConfirmDeletePkgId(null);

    const res = await deleteTeacherPackageApi(targetId);
    if (res.success && res.packages) {
      setPackages(res.packages);
      setActivePackageId(res.activePackageId || '');
      setSelectedPkgId(res.packages[0]?.id || '');
      setBannerNotice({ type: 'success', text: 'Paket soal dihapus dari Bank Soal.' });
      await loadAllTeacherData();
    } else {
      setBannerNotice({ type: 'error', text: res.message || 'Gagal menghapus paket.' });
    }
  };

  const handleSyncToGame = async () => {
    if (!selectedPackage || isSyncingGame) return;
    setIsSyncingGame(true);
    setLastSyncRunResult(null);
    setBannerNotice(null);

    try {
      const res = await publishTeacherPackageApi(
        selectedPackage.id,
        createNewVersionOnSync,
        true
      );

      setLastSyncRunResult({
        success: res.success,
        operationId: res.operationId,
        durationMs: res.durationMs,
        verifiedReadBack: res.verifiedReadBack,
        message: res.message,
        sheetsMessage: res.sheetsSyncResult?.message,
      });

      if (res.success && res.package) {
        await loadAllTeacherData();
        setSelectedPkgId(res.package.id);
        setForceResyncChecked(false);
        setCreateNewVersionOnSync(false);
        sounds.playVictory();
        setBannerNotice({
          type: 'success',
          text: `${res.message}${
            res.sheetsSyncResult ? ` | Google Sheets: ${res.sheetsSyncResult.message}` : ''
          }`,
        });
      } else {
        sounds.playWrong();
        setBannerNotice({ type: 'error', text: res.message });
      }
    } finally {
      setIsSyncingGame(false);
    }
  };

  const handleSyncPackageSheetsOnly = async () => {
    if (!selectedPackage || isSyncingSheetsPkg) return;
    setIsSyncingSheetsPkg(true);
    try {
      const res = await syncPackageToSheetsApi(selectedPackage.id);
      await loadAllTeacherData();
      setBannerNotice({
        type: res.success ? 'success' : 'error',
        text: res.message,
      });
    } finally {
      setIsSyncingSheetsPkg(false);
    }
  };

  const handleTestSheetsConnection = async () => {
    if (!googleSheetsWebAppUrl.trim()) {
      setTestResult({
        success: false,
        message: 'Masukkan URL Google Apps Script Web App terlebih dahulu di Pengaturan Integrasi.',
      });
      return;
    }
    setIsTestingSheets(true);
    setTestResult(null);
    await updateTeacherSettingsApi({
      googleSheetsWebAppUrl: googleSheetsWebAppUrl.trim(),
      spreadsheetIdOrUrl: spreadsheetIdOrUrl.trim(),
    });
    const res = await testSheetsConnection(googleSheetsWebAppUrl.trim());
    setIsTestingSheets(false);
    setTestResult(res);
    await loadAllTeacherData();
  };

  const handleSaveIntegrationSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingSettings) return;

    const trimmedNewPin = newPinInput.trim();
    if (trimmedNewPin.length > 0 && trimmedNewPin.length < 6) {
      sounds.playWrong();
      setBannerNotice({
        type: 'error',
        text: 'PIN Portal Guru baru minimal 6 karakter dan jangan gunakan PIN default yang lemah.',
      });
      return;
    }

    setIsSavingSettings(true);
    try {
      const res = await updateTeacherSettingsApi({
        googleSheetsWebAppUrl: googleSheetsWebAppUrl.trim(),
        spreadsheetIdOrUrl: spreadsheetIdOrUrl.trim(),
        sheetsSharedSecret: sheetsSharedSecretInput.trim() || undefined,
        autoSyncSheets,
        newPin: trimmedNewPin.length >= 6 ? trimmedNewPin : undefined,
      });

      if (res.success && res.settings) {
        setSettingsDto(res.settings);
        setNewPinInput('');
        setSheetsSharedSecretInput('');
        sounds.playCorrect();
        setBannerNotice({ type: 'success', text: res.message });
      } else {
        sounds.playWrong();
        setBannerNotice({ type: 'error', text: res.message });
      }
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleCopyCodeGs = () => {
    void navigator.clipboard.writeText(GOOGLE_APPS_SCRIPT_CODE);
    setCopiedScript(true);
    sounds.playClick();
    setTimeout(() => setCopiedScript(false), 2500);
  };

  // Recap Helpers
  const uniqueGrades = useMemo(() => {
    const set = new Set<string>(['Kelas 4', 'Kelas 5', 'Kelas 6']);
    sessions.forEach((s) => {
      if (s.student.grade) set.add(s.student.grade);
    });
    return Array.from(set);
  }, [sessions]);

  const uniqueQuizzesInSessions = useMemo(() => {
    const map = new Map<string, string>();
    packages.forEach((p) => map.set(p.id, p.title));
    sessions.forEach((s) => {
      if (s.packageId && !map.has(s.packageId)) {
        map.set(s.packageId, s.packageTitle || s.packageId);
      }
    });
    return Array.from(map.entries());
  }, [packages, sessions]);

  const filteredSessions = useMemo(() => {
    const qLower = searchQuery.trim().toLowerCase();
    const list = sessions.filter((s) => {
      if (filterGrade !== 'Semua' && s.student.grade !== filterGrade) return false;
      if (filterQuizId !== 'Semua' && s.packageId !== filterQuizId) return false;
      if (
        qLower &&
        !s.student.name.toLowerCase().includes(qLower) &&
        !(s.student.studentId || '').toLowerCase().includes(qLower)
      ) {
        return false;
      }
      if (filterDateFrom && s.startTime.slice(0, 10) < filterDateFrom) return false;
      if (filterDateTo && s.startTime.slice(0, 10) > filterDateTo) return false;
      return true;
    });

    list.sort((a, b) => {
      if (sortBy === 'score_desc') return b.percentageScore - a.percentageScore;
      if (sortBy === 'score_asc') return a.percentageScore - b.percentageScore;
      const ta = new Date(a.startTime).getTime();
      const tb = new Date(b.startTime).getTime();
      return sortBy === 'time_asc' ? ta - tb : tb - ta;
    });
    return list;
  }, [sessions, filterGrade, filterQuizId, searchQuery, filterDateFrom, filterDateTo, sortBy]);

  const computeSessionMetrics = (s: StudentSession) => {
    const pkg = packages.find((p) => p.id === s.packageId);
    const totalQuestions =
      pkg?.chestMappings?.length ||
      pkg?.questions.filter((q) => q.isActive !== false).length ||
      s.chestMappings?.length ||
      Object.keys(s.answers || {}).length ||
      0;
    const answersList = Object.values(s.answers || {});
    const completedCount = s.chestsCompleted.length;
    const correctCount = answersList.filter((a) => a.isCorrect === true).length;
    const wrongCount = answersList.filter((a) => a.isCorrect === false).length;
    const pendingCount = answersList.filter(
      (a) => a.gradingStatus === 'pending_review' && !a.isGradedManually
    ).length;
    const remainingCount = Math.max(0, totalQuestions - completedCount);

    let statusLabel = 'Sedang Berjalan';
    let statusType: 'pending_review' | 'completed' | 'in_progress' = 'in_progress';
    if (pendingCount > 0) {
      statusLabel = `Perlu Review (${pendingCount})`;
      statusType = 'pending_review';
    } else if (s.isCompleted) {
      statusLabel = 'Selesai (Final)';
      statusType = 'completed';
    }

    return {
      totalQuestions,
      completedCount,
      correctCount,
      wrongCount,
      pendingCount,
      remainingCount,
      statusLabel,
      statusType,
    };
  };

  const handleExportCsv = () => {
    sounds.playClick();
    if (filteredSessions.length === 0) {
      setBannerNotice({
        type: 'error',
        text: 'Belum ada data sesi siswa sesuai filter untuk diekspor.',
      });
      return;
    }

    const headers = [
      'Waktu Mulai',
      'ID Sesi',
      'ID Siswa',
      'Nama Siswa',
      'Kelas',
      'ID Kuis',
      'Judul Kuis',
      'Selesai',
      'Benar',
      'Salah',
      'Sisa Soal',
      'Skor',
      'Skor Maks',
      'Persentase',
      'Status Koreksi',
      'Status Google Sheets',
    ];

    const rows = filteredSessions.map((s) => {
      const m = computeSessionMetrics(s);
      return [
        `"${new Date(s.startTime).toLocaleString('id-ID')}"`,
        s.sessionId,
        s.student.studentId || '',
        `"${s.student.name.replace(/"/g, '""')}"`,
        `"${s.student.grade.replace(/"/g, '""')}"`,
        s.packageId,
        `"${s.packageTitle.replace(/"/g, '""')}"`,
        `${m.completedCount}/${m.totalQuestions}`,
        m.correctCount,
        m.wrongCount,
        m.remainingCount,
        s.totalScore,
        s.maxPossibleScore,
        `${s.percentageScore}%`,
        `"${m.statusLabel}"`,
        s.sheetsSyncStatus || (s.syncedToSheets ? 'synced' : 'idle'),
      ];
    });

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `Rekap_Pirate_Academy_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleRetrySessionSync = async (sessionId: string) => {
    if (retryingSessionId) return;
    setRetryingSessionId(sessionId);
    try {
      const res = await retrySessionSheetsSyncApi(sessionId);
      if (res.session) {
        setSessions((prev) =>
          prev.map((s) => (s.sessionId === res.session!.sessionId ? res.session! : s))
        );
      }
      setBannerNotice({
        type: res.success ? 'success' : 'error',
        text: res.message,
      });
    } finally {
      setRetryingSessionId(null);
    }
  };

  const getQuestionForAnswer = (session: StudentSession, questionId: string): Question => {
    const pkg = packages.find((p) => p.id === session.packageId);
    const found = pkg?.questions.find((q) => q.id === questionId);
    if (found) return found;
    const ans = session.answers[questionId];
    return {
      id: questionId,
      number: ans?.questionNumber || 1,
      type: ans?.questionType || 'short_answer',
      prompt: ans?.questionPrompt || `Soal #${ans?.questionNumber || ''}`,
      points: ans?.maxPoints || 10,
      correctAnswer: ans?.correctAnswerSnapshot,
    };
  };

  // ========================
  // 1. PIXEL ART PIN GATE & SECURE INITIAL SETUP
  // ========================
  if (!isAuthenticated) {
    if (isLoadingAuthStatus && !authStatus && !authStatusError) {
      return (
        <div className="pixel-portal relative w-full h-screen overflow-y-auto flex items-center justify-center p-4">
          <div className="px-card-gold w-full max-w-md p-6 sm:p-8 text-center space-y-4">
            <div className="w-16 h-16 bg-[#7c3aed] border-2 border-[#facc15] shadow-[4px_4px_0px_#0a0414] mx-auto flex items-center justify-center">
              <Shield className="w-8 h-8 text-[#facc15] animate-pulse" />
            </div>
            <h2 className="text-lg font-bold text-[#facc15]">
              PORTAL GURU PIRATE ACADEMY
            </h2>
            <p className="text-xs text-[#cbb7eb]">
              Memeriksa status autentikasi Portal Guru dari server...
            </p>
            <button
              type="button"
              onClick={onBackToGame}
              className="px-btn px-btn-dark w-full py-2 text-xs cursor-pointer"
            >
              &larr; Kembali ke Layar Siswa
            </button>
          </div>
        </div>
      );
    }

    if (authStatusError && !authStatus) {
      return (
        <div className="pixel-portal relative w-full h-screen overflow-y-auto flex items-center justify-center p-4">
          <div className="px-card-gold w-full max-w-md p-6 sm:p-8 text-center space-y-5">
            <div className="w-16 h-16 bg-red-950 border-2 border-[#ef4444] shadow-[4px_4px_0px_#0a0414] mx-auto flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-[#fca5a5]" />
            </div>
            <div className="space-y-2">
              <h2 className="text-lg font-bold text-[#fca5a5]">
                GAGAL TERHUBUNG KE API PORTAL GURU
              </h2>
              <p className="text-xs text-[#cbb7eb] leading-relaxed">{authStatusError}</p>
            </div>
            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => void refreshAuthStatus()}
                className="px-btn px-btn-gold w-full py-2.5 text-xs uppercase cursor-pointer"
              >
                Periksa Ulang Koneksi API
              </button>
              <button
                type="button"
                onClick={onBackToGame}
                className="px-btn px-btn-dark w-full py-2 text-xs cursor-pointer"
              >
                &larr; Kembali ke Layar Siswa
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (authStatus && authStatus.requiresInitialSetup) {
      return (
        <div className="pixel-portal relative w-full h-screen overflow-y-auto flex items-center justify-center p-4">
          <div className="px-card-gold w-full max-w-md p-6 sm:p-8 text-center space-y-5">
            <div className="w-16 h-16 bg-[#7c3aed] border-2 border-[#facc15] shadow-[4px_4px_0px_#0a0414] mx-auto flex items-center justify-center">
              <Key className="w-8 h-8 text-[#facc15]" />
            </div>

            <div className="space-y-2">
              <h2 className="text-lg sm:text-xl font-bold text-[#facc15]">
                SETUP AWAL PIN PORTAL GURU
              </h2>
              <p className="text-xs text-[#cbb7eb] leading-relaxed">
                PIN Portal Guru belum ditetapkan. Demi keamanan deployment publik, aktivasi PIN awal hanya dapat dilakukan oleh administrator menggunakan secret server.
              </p>
            </div>

            {!authStatus.setupSecretConfigured ? (
              <div className="text-left space-y-3 bg-[#1b102d] border-2 border-[#facc15]/60 p-4 text-xs">
                <div className="font-bold text-[#facc15]">
                  Secret Setup Server Belum Dikonfigurasi
                </div>
                <p className="text-[#cbb7eb] leading-relaxed">
                  {authStatus.setupSecretConsumed
                    ? 'Secret setup sebelumnya sudah pernah dipakai dan dikunci. Atur nilai baru pada environment server jika ingin mengulang setup.'
                    : 'Tidak ada tombol pembuatan PIN publik tanpa otorisasi server.'}
                </p>
                <div className="bg-[#0e071a] border border-[#6d28d9] p-3 font-mono text-[11px] text-[#e9d5ff] space-y-1">
                  <div>1. Buka panel Secrets / Env Vars hosting (AI Studio / Cloud Run).</div>
                  <div>2. Tambahkan <strong>TEACHER_SETUP_SECRET</strong> (untuk setup satu kali) atau <strong>TEACHER_PIN</strong> (min. 6 karakter untuk PIN permanen).</div>
                  <div>3. Restart layanan lalu muat ulang halaman ini.</div>
                </div>
                <button
                  type="button"
                  onClick={() => void refreshAuthStatus()}
                  className="px-btn px-btn-gold w-full py-2.5 text-xs uppercase cursor-pointer"
                >
                  Periksa Ulang Status Server
                </button>
                <button
                  type="button"
                  onClick={onBackToGame}
                  className="px-btn px-btn-dark w-full py-2 text-xs cursor-pointer"
                >
                  &larr; Kembali ke Layar Siswa
                </button>
              </div>
            ) : (
              <form onSubmit={handleInitialSetupSubmit} className="space-y-3.5 text-left">
                <div>
                  <label className="block text-[11px] font-bold text-[#facc15] mb-1">
                    Secret Setup Server (TEACHER_SETUP_SECRET):
                  </label>
                  <input
                    type="password"
                    value={setupSecretInput}
                    onChange={(e) => setSetupSecretInput(e.target.value)}
                    placeholder="Masukkan TEACHER_SETUP_SECRET"
                    className="px-input w-full px-3 py-2.5 text-xs font-mono text-[#facc15]"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[#facc15] mb-1">
                    PIN Guru Baru (minimal 6 karakter):
                  </label>
                  <input
                    type="password"
                    value={setupPinInput}
                    onChange={(e) => setSetupPinInput(e.target.value)}
                    placeholder="Buat PIN kuat (min. 6 karakter)"
                    className="px-input w-full px-3 py-2.5 text-sm font-bold tracking-wider text-[#facc15]"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[#facc15] mb-1">
                    Konfirmasi PIN Guru Baru:
                  </label>
                  <input
                    type="password"
                    value={setupPinConfirmInput}
                    onChange={(e) => setSetupPinConfirmInput(e.target.value)}
                    placeholder="Ulangi PIN baru"
                    className="px-input w-full px-3 py-2.5 text-sm font-bold tracking-wider text-[#facc15]"
                  />
                </div>

                {setupError && (
                  <div className="p-2.5 bg-red-950/90 border-2 border-[#ef4444] text-red-200 text-xs font-bold">
                    {setupError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmittingSetup}
                  className="px-btn px-btn-gold w-full py-3 px-4 text-xs sm:text-sm uppercase cursor-pointer"
                >
                  {isSubmittingSetup ? 'Menyimpan PIN Aman...' : 'Tetapkan PIN Guru Awal'}
                </button>

                <button
                  type="button"
                  onClick={onBackToGame}
                  className="px-btn px-btn-dark w-full py-2 text-xs cursor-pointer"
                >
                  &larr; Kembali ke Layar Siswa
                </button>
              </form>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="pixel-portal relative w-full h-screen overflow-y-auto flex items-center justify-center p-4">
        <div className="px-card-gold w-full max-w-md p-6 sm:p-8 text-center space-y-5">
          <div className="w-16 h-16 bg-[#7c3aed] border-2 border-[#facc15] shadow-[4px_4px_0px_#0a0414] mx-auto flex items-center justify-center">
            <Shield className="w-8 h-8 text-[#facc15]" />
          </div>

          <div className="space-y-2">
            <h2 className="text-lg sm:text-xl font-bold text-[#facc15]">
              PORTAL GURU PIRATE ACADEMY
            </h2>
            <p className="text-xs text-[#cbb7eb] leading-relaxed">
              Masukkan PIN guru untuk mengelola Bank Soal, Impor PDF/Word/Drive, Editor Gambar Soal, Sinkronisasi Game 3D, dan Google Sheets.
            </p>
          </div>

          {setupSuccessMessage && (
            <div className="p-2.5 bg-emerald-950/90 border-2 border-[#22c55e] text-emerald-200 text-xs font-bold">
              {setupSuccessMessage}
            </div>
          )}

          <form onSubmit={handlePinSubmit} className="space-y-4">
            <input
              type="password"
              value={enteredPin}
              onChange={(e) => setEnteredPin(e.target.value)}
              placeholder="Masukkan PIN Guru"
              className="px-input w-full px-4 py-3 text-center text-lg font-bold tracking-widest text-[#facc15]"
              autoFocus
            />

            {pinError && (
              <div className="p-2.5 bg-red-950/90 border-2 border-[#ef4444] text-red-200 text-xs font-bold">
                {pinError}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoggingIn}
              className="px-btn px-btn-gold w-full py-3 px-4 text-xs sm:text-sm uppercase cursor-pointer"
            >
              {isLoggingIn ? 'Memverifikasi PIN...' : 'Masuk Portal Guru'}
            </button>

            <button
              type="button"
              onClick={onBackToGame}
              className="px-btn px-btn-dark w-full py-2 text-xs cursor-pointer"
            >
              &larr; Kembali ke Layar Siswa
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Sync readiness evaluation for Sinkronisasi Game tab
  const isSelectedAlreadySynced = Boolean(
    selectedPackage &&
      selectedPackage.id === activePackageId &&
      selectedPackage.isPublished &&
      selectedPackage.lastSyncStatus === 'synced'
  );
  const canExecuteGameSync = Boolean(
    selectedPackage &&
      selectedPkgValidation?.valid &&
      (!isSelectedAlreadySynced || createNewVersionOnSync || forceResyncChecked)
  );

  const navItems: Array<{ id: PortalMenu; label: string; icon: React.ReactNode }> = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'bank', label: `Bank Soal (${packages.length})`, icon: <Database className="w-4 h-4" /> },
    { id: 'import', label: 'Impor Soal', icon: <FileUp className="w-4 h-4" /> },
    { id: 'editor', label: 'Editor & Pratinjau', icon: <Edit3 className="w-4 h-4" /> },
    { id: 'sync', label: 'Sinkronisasi Game', icon: <Rocket className="w-4 h-4" /> },
    { id: 'sheets', label: 'Google Sheets', icon: <FileSpreadsheet className="w-4 h-4" /> },
    { id: 'recap', label: `Rekap Nilai (${sessions.length})`, icon: <Users className="w-4 h-4" /> },
    { id: 'settings', label: 'Pengaturan Integrasi', icon: <Settings className="w-4 h-4" /> },
  ];

  // ========================
  // 2. MAIN PIXEL ART PORTAL
  // ========================
  return (
    <div className="pixel-portal relative w-full h-screen overflow-y-auto flex flex-col">
      {/* Top Pixel Header */}
      <header className="bg-[#21113b] border-b-4 border-[#facc15] px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#7c3aed] border-2 border-[#facc15] shadow-[3px_3px_0px_#0a0414] flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-[#facc15]" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold text-[#facc15] leading-tight">
              PORTAL GURU • PIRATE ACADEMY 3D
            </h1>
            <div className="text-[11px] text-[#cbb7eb] flex flex-wrap items-center gap-2">
              <span className="text-[#f472b6] font-bold">Pixel Retro Manager</span>
              <span>•</span>
              <span className="text-[#4ade80] font-bold">WebSocket Aktif</span>
              {lastUpdatedAt && (
                <>
                  <span>•</span>
                  <span>Update: {new Date(lastUpdatedAt).toLocaleTimeString('id-ID')}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadAllTeacherData()}
            disabled={isLoadingData}
            className="px-btn px-btn-dark py-1.5 px-3 text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingData ? 'animate-spin' : ''}`} />
            <span>Segarkan</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setTeacherToken('');
              setIsAuthenticated(false);
              void signOutGoogleDrive();
            }}
            className="px-btn px-btn-pink py-1.5 px-3 text-xs cursor-pointer"
          >
            Keluar PIN
          </button>

          <button
            type="button"
            onClick={onBackToGame}
            className="px-btn px-btn-gold py-1.5 px-3.5 text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Kembali ke Game</span>
          </button>
        </div>
      </header>

      {/* 8-Menu Pixel Navigation Bar */}
      <nav className="bg-[#1b0e32] border-b-2 border-[#6d28d9] px-3 sm:px-6 py-2 flex items-center gap-2 overflow-x-auto shrink-0">
        {navItems.map((item) => {
          const isActive = currentMenu === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                sounds.playClick();
                setCurrentMenu(item.id);
              }}
              className={`px-btn px-3 py-2 text-xs flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                isActive ? 'px-btn-gold' : 'px-btn-dark hover:border-[#f472b6]'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 p-4 sm:p-6 max-w-7xl mx-auto w-full space-y-5">
        {bannerNotice && (
          <div
            className={`px-card p-3.5 text-xs font-bold flex items-center justify-between gap-2 ${
              bannerNotice.type === 'success'
                ? 'border-[#22c55e] bg-emerald-950/90 text-emerald-100'
                : 'border-[#ef4444] bg-red-950/90 text-red-100'
            }`}
          >
            <div className="flex items-center gap-2">
              {bannerNotice.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-[#22c55e] shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-[#ef4444] shrink-0" />
              )}
              <span>{bannerNotice.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setBannerNotice(null)}
              aria-label="Tutup pemberitahuan"
              className="p-1 hover:bg-white/10 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* MENU 1: DASHBOARD */}
        {currentMenu === 'dashboard' && (
          <div className="space-y-5">
            {/* Live Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div className="px-card p-4 space-y-1">
                <div className="text-[11px] font-bold text-[#cbb7eb]">SOAL TERSIMPAN</div>
                <div className="px-font-display text-2xl font-bold text-[#facc15] tabular-nums">
                  {dashboardStats.totalSavedQuestions}
                </div>
                <div className="text-[11px] text-[#cbb7eb]">
                  Dalam {dashboardStats.totalPackages} paket di Bank Soal
                </div>
              </div>

              <div className="px-card-gold p-4 space-y-1">
                <div className="text-[11px] font-bold text-[#cbb7eb]">AKTIF DI GAME 3D</div>
                <div className="px-font-display text-2xl font-bold text-[#4ade80] tabular-nums">
                  {dashboardStats.activeQuestionsCount}
                </div>
                <div className="text-[11px] text-[#f8f4ff]">
                  {dashboardStats.unsyncedCount > 0
                    ? `${dashboardStats.unsyncedCount} soal draf menunggu sinkronisasi`
                    : 'Semua soal aktif tersinkron ke peti'}
                </div>
              </div>

              <div
                className={`px-card p-4 space-y-1 ${
                  dashboardStats.totalValidationErrors > 0 ? 'border-[#ef4444]' : ''
                }`}
              >
                <div className="text-[11px] font-bold text-[#cbb7eb]">ERROR VALIDASI</div>
                <div
                  className={`px-font-display text-2xl font-bold tabular-nums ${
                    dashboardStats.totalValidationErrors > 0
                      ? 'text-[#f87171]'
                      : 'text-[#4ade80]'
                  }`}
                >
                  {dashboardStats.totalValidationErrors}
                </div>
                <div className="text-[11px] text-[#cbb7eb]">
                  {dashboardStats.totalValidationErrors > 0
                    ? 'Perbaiki di Editor & Pratinjau'
                    : 'Tidak ada error validasi'}
                </div>
              </div>

              <div className="px-card-pink p-4 space-y-1">
                <div className="text-[11px] font-bold text-[#cbb7eb]">GOOGLE SHEETS &amp; NILAI</div>
                <div className="text-sm font-bold text-[#f472b6]">
                  {dashboardStats.sheetsConfigured ? 'Web App Terpasang' : 'Belum Dikonfigurasi'}
                </div>
                <div className="text-[11px] text-[#f8f4ff]">
                  {dashboardStats.studentSessionsCount} sesi hasil siswa •{' '}
                  {dashboardStats.lastSyncTs
                    ? `Sinkron: ${new Date(dashboardStats.lastSyncTs).toLocaleTimeString('id-ID')}`
                    : 'Belum pernah sinkron'}
                </div>
              </div>
            </div>

            {/* Quick Shortcuts */}
            <div className="px-card p-5 space-y-3">
              <h2 className="text-sm font-bold text-[#facc15]">AKSI CEPAT PORTAL GURU</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <button
                  type="button"
                  onClick={() => setCurrentMenu('import')}
                  className="px-btn px-btn-gold p-3.5 text-xs flex items-center gap-2 cursor-pointer"
                >
                  <FileUp className="w-4 h-4 shrink-0" />
                  <span>Impor Soal (PDF/Word/Drive)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentMenu('editor')}
                  className="px-btn px-btn-pink p-3.5 text-xs flex items-center gap-2 cursor-pointer"
                >
                  <Edit3 className="w-4 h-4 shrink-0" />
                  <span>Edit Soal &amp; Tambah Gambar</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentMenu('sync')}
                  className="px-btn px-btn-purple p-3.5 text-xs flex items-center gap-2 cursor-pointer"
                >
                  <Rocket className="w-4 h-4 shrink-0" />
                  <span>Sinkronkan ke Game 3D</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentMenu('sheets')}
                  className="px-btn px-btn-dark p-3.5 text-xs flex items-center gap-2 cursor-pointer"
                >
                  <FileSpreadsheet className="w-4 h-4 text-[#facc15] shrink-0" />
                  <span>Status Google Sheets</span>
                </button>
              </div>
            </div>

            {/* 9-Stage Workflow Overview + Recent Activities */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-5 px-card p-4 space-y-3">
                <h3 className="text-xs font-bold text-[#facc15]">
                  ALUR WAJIB PENYIAPAN SOAL (9 TAHAP)
                </h3>
                <div className="space-y-1.5 text-xs">
                  {[
                    '1. IMPOR — Pilih PDF, Word (.docx), atau Google Drive',
                    '2. EKSTRAKSI — Server membaca teks & mendeteksi tipe soal',
                    '3. PRATINJAU — Tinjau ringkasan hasil ekstraksi di Draf',
                    '4. EDIT — Perbaiki soal, kunci, pembahasan & gambar manual',
                    '5. VALIDASI — Pastikan tidak ada opsi/kunci yang kosong',
                    '6. SIMPAN DRAF — Simpan sementara di Bank Soal',
                    '7. TERBITKAN — Pilih paket untuk diaktifkan ke peti 3D',
                    '8. SINKRONISASI — Kirim ke Game 3D & Google Sheets',
                    '9. VERIFIKASI — Sistem membaca ulang /api/quiz/active',
                  ].map((step) => (
                    <div key={step} className="px-subcard px-3 py-1.5 text-[#f8f4ff]">
                      {step}
                    </div>
                  ))}
                </div>
              </div>

              <div className="lg:col-span-7 px-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-[#f472b6] flex items-center gap-1.5">
                    <Activity className="w-4 h-4" />
                    <span>AKTIVITAS TERBARU</span>
                  </h3>
                  <span className="text-[11px] text-[#cbb7eb]">{activities.length} catatan</span>
                </div>

                {activities.length === 0 ? (
                  <div className="px-subcard p-6 text-center text-xs text-[#cbb7eb]">
                    Belum ada catatan aktivitas. Mulai dengan mengimpor atau mengedit soal.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {activities.slice(0, 12).map((act) => (
                      <div
                        key={act.id}
                        className="px-subcard p-2.5 flex items-start justify-between gap-2 text-xs"
                      >
                        <div className="space-y-0.5 min-w-0">
                          <div className="font-bold text-[#facc15]">{act.title}</div>
                          <div className="text-[11px] text-[#f8f4ff] break-words">{act.detail}</div>
                        </div>
                        <span className="text-[10px] text-[#cbb7eb] shrink-0">
                          {new Date(act.timestamp).toLocaleTimeString('id-ID')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* MENU 2: BANK SOAL */}
        {currentMenu === 'bank' && (
          <div className="space-y-5">
            <div className="px-card p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs font-bold text-[#facc15] flex items-center gap-1.5">
                  <Layers className="w-4 h-4" />
                  <span>Pilih Paket Bank Soal:</span>
                </label>
                <select
                  value={selectedPackage?.id || ''}
                  onChange={(e) => setSelectedPkgId(e.target.value)}
                  className="px-input px-3 py-2 text-xs font-bold max-w-md"
                >
                  {packages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id === activePackageId ? '[AKTIF] ' : ''}
                      {p.title} ({p.questions.length} Soal)
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentMenu('import')}
                  className="px-btn px-btn-pink px-3.5 py-2 text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <FileUp className="w-3.5 h-3.5" />
                  <span>Impor Dokumen</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleCreateEmptyDraft()}
                  className="px-btn px-btn-gold px-3.5 py-2 text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Buat Draf Baru</span>
                </button>
              </div>
            </div>

            {selectedPackage && (
              <>
                <div className="px-card-gold p-5 flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base sm:text-lg font-bold text-[#facc15]">
                        {selectedPackage.title}
                      </h2>
                      {(() => {
                        const badge = getPackageStatusBadge(selectedPackage, activePackageId);
                        return (
                          <span className={`px-badge ${badge.className}`}>{badge.label}</span>
                        );
                      })()}
                    </div>
                    <p className="text-xs text-[#f8f4ff]">{selectedPackage.description}</p>
                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#cbb7eb] pt-1">
                      <span>
                        ID: <code className="text-[#facc15]">{selectedPackage.id}</code>
                      </span>
                      <span>•</span>
                      <span>Versi {selectedPackage.version || 1}</span>
                      <span>•</span>
                      <span>{selectedPackage.gradeLevel}</span>
                      <span>•</span>
                      <span>
                        {selectedPackage.questions.filter((q) => q.isActive !== false).length} Aktif /{' '}
                        {selectedPackage.questions.length} Total Soal
                      </span>
                      {selectedPackage.sourceFileName && (
                        <>
                          <span>•</span>
                          <span>Sumber: {selectedPackage.sourceFileName}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCurrentMenu('editor')}
                      className="px-btn px-btn-purple px-4 py-2 text-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Buka di Editor &amp; Pratinjau</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setCurrentMenu('sync')}
                      className="px-btn px-btn-gold px-4 py-2 text-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      <Rocket className="w-3.5 h-3.5" />
                      <span>Sinkronkan ke Game</span>
                    </button>

                    {packages.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setConfirmDeletePkgId(selectedPackage.id)}
                        className="px-btn px-btn-red p-2 cursor-pointer"
                        title="Hapus Paket Soal"
                        aria-label="Hapus Paket Soal"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Chest 3D Mapping Viewer */}
                <div className="px-card p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs font-bold text-[#facc15]">
                      PEMETAAN PETI 3D &rarr; SOAL AKTIF ({(selectedPackage.chestMappings || []).length} PETI)
                    </h3>
                    <span className="text-[11px] text-[#cbb7eb]">
                      Hanya soal berstatus Aktif yang muncul sebagai peti harta di pulau 3D.
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-[11px]">
                    {(selectedPackage.chestMappings || []).map((m) => (
                      <div
                        key={m.chestId}
                        className="px-subcard px-3 py-2 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-[#facc15]">
                            {m.chestId} &rarr; Soal #{m.chestNumber}
                          </div>
                          <div className="text-[#f8f4ff] truncate flex items-center gap-1">
                            <MapPin className="w-3 h-3 text-[#f472b6] shrink-0" />
                            <span>{m.locationName}</span>
                          </div>
                          {m.zoneType && (
                            <div className="text-[10px] text-[#4ade80] truncate">
                              {CHEST_ZONE_LABELS[m.zoneType]}
                            </div>
                          )}
                        </div>
                        <code className="text-[10px] text-[#cbb7eb] shrink-0">{m.questionId}</code>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* MENU 3: IMPOR SOAL */}
        {currentMenu === 'import' && (
          <QuestionImporter
            onDraftReadyForEditor={(pkg, summaryText) => {
              setPackages((prev) => [pkg, ...prev.filter((p) => p.id !== pkg.id)]);
              setSelectedPkgId(pkg.id);
              setCurrentMenu('editor');
              setBannerNotice({ type: 'success', text: summaryText });
              void loadAllTeacherData();
            }}
            onCreateBlankManual={() => void handleCreateEmptyDraft()}
          />
        )}

        {/* MENU 4: EDITOR DAN PRATINJAU */}
        {currentMenu === 'editor' && (
          <div className="space-y-4">
            <div className="px-card p-3.5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-bold text-[#facc15]">Paket Sedang Diedit:</span>
                <select
                  value={selectedPackage?.id || ''}
                  onChange={(e) => setSelectedPkgId(e.target.value)}
                  className="px-input px-3 py-1.5 text-xs font-bold max-w-md"
                >
                  {packages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id === activePackageId ? '[AKTIF] ' : ''}
                      {p.title} ({p.questions.length} Soal)
                    </option>
                  ))}
                </select>
              </div>
              <span className="text-[11px] text-[#cbb7eb]">
                Edit &amp; simpan draf terlebih dahulu sebelum menyinkronkan ke Game 3D.
              </span>
            </div>

            {selectedPackage ? (
              <QuestionEditorPanel
                pkg={selectedPackage}
                onPackageSaved={(updated) => {
                  setPackages((prev) =>
                    prev.map((p) => (p.id === updated.id ? updated : p))
                  );
                  void loadAllTeacherData();
                }}
                onGoToSync={(pkgId) => {
                  setSelectedPkgId(pkgId);
                  setCurrentMenu('sync');
                }}
              />
            ) : (
              <div className="px-card p-6 text-center text-xs text-[#cbb7eb]">
                Belum ada paket soal dipilih.
              </div>
            )}
          </div>
        )}

        {/* MENU 5: SINKRONISASI GAME */}
        {currentMenu === 'sync' && (
          <div className="space-y-5">
            <div className="px-card-gold p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-[#facc15]">
                    SINKRONISASI BANK SOAL KE GAME 3D &amp; VERIFIKASI
                  </h2>
                  <p className="text-xs text-[#cbb7eb] mt-1">
                    Sistem memvalidasi seluruh soal aktif, memperbarui peti 3D, memverifikasi ulang{' '}
                    <code className="text-[#facc15]">/api/quiz/active</code>, dan menyinkronkan ke Google Sheets (jika aktif).
                  </p>
                </div>

                <select
                  value={selectedPackage?.id || ''}
                  onChange={(e) => {
                    setSelectedPkgId(e.target.value);
                    setLastSyncRunResult(null);
                  }}
                  className="px-input px-3 py-2 text-xs font-bold max-w-sm"
                >
                  {packages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id === activePackageId ? '[AKTIF] ' : ''}
                      {p.title}
                    </option>
                  ))}
                </select>
              </div>

              {selectedPackage && selectedPkgValidation && (
                <div className="space-y-4">
                  {/* Validation Check Summary */}
                  <div
                    className={`px-subcard p-4 space-y-2 ${
                      selectedPkgValidation.valid ? 'border-[#22c55e]' : 'border-[#ef4444]'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 font-bold text-xs">
                        {selectedPkgValidation.valid ? (
                          <>
                            <CheckCircle2 className="w-4 h-4 text-[#22c55e]" />
                            <span className="text-[#4ade80]">
                              VALIDASI LOLOS: {selectedPkgValidation.activeCount} soal aktif siap ditempatkan di peti 3D
                            </span>
                          </>
                        ) : (
                          <>
                            <AlertCircle className="w-4 h-4 text-[#ef4444]" />
                            <span className="text-[#fca5a5]">
                              SINKRONISASI DIBLOKIR: Ditemukan {selectedPkgValidation.blockingErrorCount} error validasi
                            </span>
                          </>
                        )}
                      </div>

                      {!selectedPkgValidation.valid && (
                        <div className="flex flex-wrap items-center gap-2">
                          {Object.keys(selectedPkgValidation.questionErrors).length > 0 &&
                            selectedPkgValidation.validActiveCount > 0 && (
                              <button
                                type="button"
                                onClick={async () => {
                                  const errIds = new Set(Object.keys(selectedPkgValidation.questionErrors));
                                  const updatedQuestions = selectedPackage.questions.map((q) =>
                                    errIds.has(q.id) ? { ...q, isActive: false } : q
                                  );
                                  const res = await saveTeacherPackageApi({
                                    ...selectedPackage,
                                    questions: updatedQuestions,
                                  });
                                  if (res.success && res.package) {
                                    setBannerNotice({
                                      type: 'success',
                                      text: `${errIds.size} soal bermasalah dinonaktifkan sementara agar ${selectedPkgValidation.validActiveCount} soal valid siap diterbitkan.`,
                                    });
                                    await loadAllTeacherData();
                                  }
                                }}
                                className="px-btn px-btn-dark px-3 py-1.5 text-xs cursor-pointer"
                              >
                                Nonaktifkan {Object.keys(selectedPkgValidation.questionErrors).length} Soal Bermasalah
                              </button>
                            )}
                          <button
                            type="button"
                            onClick={() => setCurrentMenu('editor')}
                            className="px-btn px-btn-pink px-3 py-1.5 text-xs cursor-pointer"
                          >
                            Perbaiki di Editor &rarr;
                          </button>
                        </div>
                      )}
                    </div>

                    {/* 6-Type Breakdown & Matched Key Metrics */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-[11px] pt-1">
                      {ALL_QUESTION_TYPES.map((qType) => (
                        <div
                          key={qType}
                          className="bg-[#140924] border border-[#4c1d95] px-2.5 py-1.5 flex items-center justify-between gap-1"
                        >
                          <span className="text-[#cbb7eb] truncate">{getQuestionTypeLabel(qType)}</span>
                          <span className="font-bold text-[#facc15] tabular-nums">
                            {selectedPkgValidation.byType[qType]}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#cbb7eb]">
                      <span>
                        Kunci Terverifikasi:{' '}
                        <strong className="text-[#4ade80]">{selectedPkgValidation.matchedKeysCount}</strong>
                      </span>
                      <span>•</span>
                      <span>
                        Perlu Cek (NEEDS_REVIEW):{' '}
                        <strong className="text-[#facc15]">{selectedPkgValidation.needsReviewCount}</strong>
                      </span>
                      <span>•</span>
                      <span>
                        Error Memblokir:{' '}
                        <strong className={selectedPkgValidation.blockingErrorCount > 0 ? 'text-[#f87171]' : 'text-[#4ade80]'}>
                          {selectedPkgValidation.blockingErrorCount}
                        </strong>
                      </span>
                    </div>

                    {selectedPkgValidation.summaryErrors.map((err, i) => (
                      <div key={i} className="text-xs text-[#fca5a5]">
                        • {err}
                      </div>
                    ))}

                    {Object.entries(selectedPkgValidation.questionErrors).map(([qId, errs]) => {
                      const qObj = selectedPackage.questions.find((q) => q.id === qId);
                      return (
                        <div key={qId} className="text-xs text-[#fca5a5]">
                          • <strong>Soal #{qObj?.number || qId} ({getQuestionTypeLabel(qObj?.type)}):</strong>{' '}
                          {errs.join(' ')}
                        </div>
                      );
                    })}

                    {selectedPkgValidation.inactiveCount > 0 && (
                      <div className="text-[11px] text-[#cbb7eb]">
                        Info: {selectedPkgValidation.inactiveCount} soal berstatus Nonaktif tidak akan dimasukkan ke peti 3D, namun tetap aman di Bank Soal.
                      </div>
                    )}
                  </div>

                  {/* Sync Options */}
                  <div className="flex flex-wrap items-center gap-4 text-xs text-[#f8f4ff]">
                    {selectedPackage.isPublished && (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={createNewVersionOnSync}
                          onChange={(e) => setCreateNewVersionOnSync(e.target.checked)}
                          className="accent-[#facc15]"
                        />
                        <span>Terbitkan sebagai Versi Baru (riwayat nilai versi lama tetap terpisah)</span>
                      </label>
                    )}

                    {isSelectedAlreadySynced && (
                      <label className="flex items-center gap-2 cursor-pointer text-[#facc15]">
                        <input
                          type="checkbox"
                          checked={forceResyncChecked}
                          onChange={(e) => setForceResyncChecked(e.target.checked)}
                          className="accent-[#facc15]"
                        />
                        <span>Paket sudah tersinkron. Centang untuk sinkron ulang paksa.</span>
                      </label>
                    )}
                  </div>

                  {/* Action Button */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-[11px] text-[#cbb7eb]">
                      {selectedPackage.lastSyncedAt && (
                        <span>
                          Sinkron terakhir:{' '}
                          <strong className="text-[#facc15]">
                            {new Date(selectedPackage.lastSyncedAt).toLocaleString('id-ID')}
                          </strong>{' '}
                          (ID: {selectedPackage.lastOperationId || '-'})
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={!canExecuteGameSync || isSyncingGame}
                      onClick={() => void handleSyncToGame()}
                      className="px-btn px-btn-gold px-6 py-3 text-xs sm:text-sm flex items-center gap-2 cursor-pointer"
                    >
                      <Rocket className="w-4 h-4" />
                      <span>
                        {isSyncingGame
                          ? 'Menyinkronkan & Memverifikasi...'
                          : isSelectedAlreadySynced && !createNewVersionOnSync && !forceResyncChecked
                          ? 'Sudah Tersinkronisasi'
                          : 'Terbitkan & Sinkronkan ke Game 3D'}
                      </span>
                    </button>
                  </div>

                  {/* Live Result Card */}
                  {lastSyncRunResult && (
                    <div
                      className={`px-subcard p-4 space-y-1.5 text-xs ${
                        lastSyncRunResult.success ? 'border-[#22c55e]' : 'border-[#ef4444]'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 font-bold">
                        <span
                          className={`inline-flex items-center gap-1.5 ${
                            lastSyncRunResult.success ? 'text-[#4ade80]' : 'text-[#fca5a5]'
                          }`}
                        >
                          {lastSyncRunResult.success ? (
                            <>
                              <CheckCircle2 className="w-4 h-4 shrink-0" />
                              <span>SINKRONISASI &amp; VERIFIKASI READ-BACK BERHASIL</span>
                            </>
                          ) : (
                            <>
                              <AlertCircle className="w-4 h-4 shrink-0" />
                              <span>SINKRONISASI GAGAL</span>
                            </>
                          )}
                        </span>
                        {lastSyncRunResult.operationId && (
                          <span className="text-[11px] text-[#cbb7eb]">
                            ID: {lastSyncRunResult.operationId} • {lastSyncRunResult.durationMs} ms
                          </span>
                        )}
                      </div>
                      <p className="text-[#f8f4ff]">{lastSyncRunResult.message}</p>
                      {lastSyncRunResult.sheetsMessage && (
                        <p className="text-[#facc15]">
                          Google Sheets: {lastSyncRunResult.sheetsMessage}
                        </p>
                      )}
                      {!lastSyncRunResult.success && (
                        <button
                          type="button"
                          onClick={() => void handleSyncToGame()}
                          className="px-btn px-btn-pink px-3.5 py-1.5 text-xs mt-1 cursor-pointer"
                        >
                          Coba Lagi Sinkronisasi
                        </button>
                      )}
                    </div>
                  )}

                  {/* Honest Session Cache Explanation */}
                  <div className="px-subcard p-3.5 text-[11px] text-[#cbb7eb] leading-relaxed">
                    <strong className="text-[#facc15]">Catatan Konsistensi Sesi Siswa:</strong> Siswa yang memulai permainan <em>baru</em> setelah sinkronisasi langsung menerima paket &amp; peti soal terbaru. Siswa yang sedang berada di tengah sesi permainan tetap menyelesaikan paket versi saat mereka memulai agar perhitungan nilai dan ID soal tetap konsisten.
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* MENU 6: GOOGLE SHEETS */}
        {currentMenu === 'sheets' && (
          <div className="space-y-5">
            {/* Status Card */}
            <div className="px-card-gold p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <h2 className="text-base sm:text-lg font-bold text-[#facc15]">
                    INTEGRASI GOOGLE SHEETS (CODE.GS V11)
                  </h2>
                  <p className="text-xs text-[#cbb7eb]">
                    Sinkronisasi otomatis 6 sheet: <strong className="text-[#f8f4ff]">BankSoal</strong>,{' '}
                    <strong className="text-[#f8f4ff]">RekapNilai</strong>, Siswa, Hasil, LogSinkronisasi, dan Pengaturan.
                  </p>
                </div>

                <span
                  className={`px-badge ${
                    settingsDto?.sheetsLastError
                      ? 'bg-red-950 border-[#ef4444] text-[#fca5a5]'
                      : settingsDto?.googleSheetsWebAppUrl
                      ? 'bg-emerald-950 border-[#22c55e] text-[#86efac]'
                      : 'bg-amber-950 border-[#facc15] text-[#facc15]'
                  }`}
                >
                  {settingsDto?.sheetsLastError
                    ? 'Error Koneksi Terakhir'
                    : settingsDto?.googleSheetsWebAppUrl
                    ? 'Web App Terkonfigurasi'
                    : 'Belum Dikonfigurasi'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                <div className="px-subcard p-3">
                  <div className="text-[10px] text-[#cbb7eb]">SPREADSHEET ID (TERMASKER)</div>
                  <div className="font-mono font-bold text-[#facc15] mt-0.5">
                    {settingsDto?.maskedSpreadsheetId || 'Belum diisi'}
                  </div>
                </div>
                <div className="px-subcard p-3">
                  <div className="text-[10px] text-[#cbb7eb]">SINKRONISASI TERAKHIR</div>
                  <div className="font-bold text-[#f8f4ff] mt-0.5">
                    {settingsDto?.sheetsLastSyncAt
                      ? new Date(settingsDto.sheetsLastSyncAt).toLocaleString('id-ID')
                      : 'Belum pernah'}
                  </div>
                </div>
                <div className="px-subcard p-3">
                  <div className="text-[10px] text-[#cbb7eb]">SOAL AKTIF / SESI SISWA</div>
                  <div className="font-bold text-[#4ade80] mt-0.5">
                    {dashboardStats.activeQuestionsCount} soal • {sessions.length} sesi
                  </div>
                </div>
                <div className="px-subcard p-3">
                  <div className="text-[10px] text-[#cbb7eb]">ERROR TERAKHIR</div>
                  <div className="font-bold text-[#f472b6] truncate mt-0.5">
                    {settingsDto?.sheetsLastError || 'Tidak ada'}
                  </div>
                </div>
              </div>

              {/* Required Google Sheets Action Buttons */}
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => void handleTestSheetsConnection()}
                  disabled={isTestingSheets}
                  className="px-btn px-btn-gold px-4 py-2 text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isTestingSheets ? 'animate-spin' : ''}`} />
                  <span>{isTestingSheets ? 'Menguji Koneksi...' : 'Uji Koneksi'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleSyncPackageSheetsOnly()}
                  disabled={isSyncingSheetsPkg || !selectedPackage}
                  className="px-btn px-btn-purple px-4 py-2 text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <CloudUpload className="w-3.5 h-3.5" />
                  <span>
                    {isSyncingSheetsPkg ? 'Menyinkronkan...' : 'Sinkronkan Soal ke Sheets'}
                  </span>
                </button>

                {settingsDto?.spreadsheetOpenUrl ? (
                  <a
                    href={settingsDto.spreadsheetOpenUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-btn px-btn-green px-4 py-2 text-xs flex items-center gap-1.5"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Buka Google Sheets</span>
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => setCurrentMenu('settings')}
                    className="px-btn px-btn-dark px-4 py-2 text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Isi Link Spreadsheet di Pengaturan</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleCopyCodeGs}
                  className="px-btn px-btn-pink px-4 py-2 text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copiedScript ? 'Code.gs Disalin!' : 'Salin Code.gs'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowGuideModal(true)}
                  className="px-btn px-btn-dark px-4 py-2 text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <HelpCircle className="w-3.5 h-3.5 text-[#facc15]" />
                  <span>Lihat Panduan Instalasi</span>
                </button>
              </div>

              {testResult && (
                <div
                  className={`px-subcard p-3 text-xs font-bold flex items-center gap-2 ${
                    testResult.success
                      ? 'border-[#22c55e] text-[#86efac]'
                      : 'border-[#ef4444] text-[#fca5a5]'
                  }`}
                >
                  {testResult.success ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                  )}
                  <span>{testResult.message}</span>
                </div>
              )}
            </div>

            {/* Code.gs Preview & Sync Operation Logs */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-6 px-card p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-[#facc15]">
                    PRATINJAU CODE.GS LENGKAP
                  </h3>
                  <button
                    type="button"
                    onClick={handleCopyCodeGs}
                    className="px-btn px-btn-pink px-3 py-1 text-[11px] inline-flex items-center gap-1 cursor-pointer"
                  >
                    {copiedScript && <Check className="w-3 h-3" />}
                    <span>{copiedScript ? 'Tersalin' : 'Salin Semua'}</span>
                  </button>
                </div>
                <pre className="bg-[#090312] border-2 border-[#4c1d95] p-3 text-[10px] font-mono text-[#e9d5ff] h-64 overflow-y-auto select-all">
                  {GOOGLE_APPS_SCRIPT_CODE}
                </pre>
              </div>

              <div className="lg:col-span-6 px-card p-4 space-y-2.5">
                <h3 className="text-xs font-bold text-[#f472b6]">
                  RIWAYAT LOG SINKRONISASI ({syncLogs.length})
                </h3>
                {syncLogs.length === 0 ? (
                  <div className="px-subcard p-6 text-center text-xs text-[#cbb7eb]">
                    Belum ada operasi sinkronisasi yang tercatat.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {syncLogs.map((log) => (
                      <div
                        key={log.id}
                        className={`px-subcard p-2.5 text-xs space-y-1 ${
                          log.status === 'success'
                            ? 'border-[#22c55e]'
                            : log.status === 'failed'
                            ? 'border-[#ef4444]'
                            : ''
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-[#facc15]">
                            {log.operationType} ({log.itemCount} item)
                          </span>
                          <span
                            className={`text-[10px] font-bold ${
                              log.status === 'success' ? 'text-[#4ade80]' : 'text-[#fca5a5]'
                            }`}
                          >
                            {log.status === 'success' ? 'SUKSES' : 'GAGAL'} •{' '}
                            {log.durationMs ?? 0} ms
                          </span>
                        </div>
                        <div className="text-[11px] text-[#f8f4ff]">{log.message}</div>
                        <div className="text-[10px] text-[#cbb7eb]">
                          ID: {log.id} • {new Date(log.startedAt).toLocaleString('id-ID')}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* MENU 7: REKAP NILAI */}
        {currentMenu === 'recap' && (
          <div className="space-y-4">
            <div className="px-card p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm sm:text-base font-bold text-[#facc15]">
                  REKAP NILAI &amp; KOREKSI JAWABAN SISWA
                </h2>
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="px-btn px-btn-green px-4 py-2 text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Ekspor CSV ({filteredSessions.length})</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 text-xs">
                <div className="relative lg:col-span-2">
                  <Search className="w-4 h-4 text-[#cbb7eb] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Cari nama / ID siswa..."
                    className="px-input w-full pl-9 pr-3 py-2 text-xs"
                  />
                </div>

                <select
                  value={filterGrade}
                  onChange={(e) => setFilterGrade(e.target.value)}
                  className="px-input px-3 py-2 text-xs"
                >
                  <option value="Semua">Semua Kelas</option>
                  {uniqueGrades.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>

                <select
                  value={filterQuizId}
                  onChange={(e) => setFilterQuizId(e.target.value)}
                  className="px-input px-3 py-2 text-xs"
                >
                  <option value="Semua">Semua Paket Kuis</option>
                  {uniqueQuizzesInSessions.map(([qId, qTitle]) => (
                    <option key={qId} value={qId}>
                      {qTitle}
                    </option>
                  ))}
                </select>

                <input
                  type="date"
                  value={filterDateFrom}
                  onChange={(e) => setFilterDateFrom(e.target.value)}
                  className="px-input px-2.5 py-2 text-xs"
                  title="Dari Tanggal"
                />

                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                  className="px-input px-3 py-2 text-xs"
                >
                  <option value="time_desc">Terbaru</option>
                  <option value="time_asc">Terlama</option>
                  <option value="score_desc">Skor Tertinggi</option>
                  <option value="score_asc">Skor Terendah</option>
                </select>
              </div>
            </div>

            <div className="px-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#140924] text-[#facc15] uppercase text-[11px] border-b-2 border-[#6d28d9]">
                    <tr>
                      <th className="p-3">Waktu</th>
                      <th className="p-3">Nama &amp; Kelas</th>
                      <th className="p-3">Paket Kuis</th>
                      <th className="p-3 text-center">Progres</th>
                      <th className="p-3 text-center">Nilai (%)</th>
                      <th className="p-3 text-center">Status Koreksi</th>
                      <th className="p-3 text-center">Google Sheets</th>
                      <th className="p-3 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#4c1d95]">
                    {filteredSessions.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-[#cbb7eb]">
                          Belum ada data sesi pengerjaan siswa sesuai filter.
                        </td>
                      </tr>
                    ) : (
                      filteredSessions.map((s) => {
                        const m = computeSessionMetrics(s);
                        const sheetsSt =
                          s.sheetsSyncStatus || (s.syncedToSheets ? 'synced' : 'idle');

                        return (
                          <tr key={s.sessionId} className="hover:bg-[#331b5a]/50">
                            <td className="p-3 text-[11px] text-[#cbb7eb] whitespace-nowrap">
                              {new Date(s.startTime).toLocaleDateString('id-ID')}{' '}
                              {new Date(s.startTime).toLocaleTimeString('id-ID', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </td>
                            <td className="p-3">
                              <div className="font-bold text-[#f8f4ff]">{s.student.name}</div>
                              <div className="text-[10px] text-[#f472b6]">{s.student.grade}</div>
                            </td>
                            <td className="p-3 max-w-[180px] truncate text-[#cbb7eb]">
                              {s.packageTitle}
                            </td>
                            <td className="p-3 text-center tabular-nums">
                              <span className="font-bold text-[#facc15]">
                                {m.completedCount}/{m.totalQuestions}
                              </span>
                              <div className="text-[10px] text-[#cbb7eb]">
                                {m.correctCount} Benar · {m.wrongCount} Salah
                              </div>
                            </td>
                            <td className="p-3 text-center tabular-nums">
                              <span className="font-bold text-[#4ade80]">
                                {s.totalScore}/{s.maxPossibleScore}
                              </span>
                              <div className="text-[10px] text-[#cbb7eb]">{s.percentageScore}%</div>
                            </td>
                            <td className="p-3 text-center">
                              <span
                                className={`px-badge ${
                                  m.statusType === 'pending_review'
                                    ? 'bg-amber-950 border-[#facc15] text-[#facc15]'
                                    : m.statusType === 'completed'
                                    ? 'bg-emerald-950 border-[#22c55e] text-[#86efac]'
                                    : 'bg-[#140924] border-[#a855f7] text-[#e9d5ff]'
                                }`}
                              >
                                {m.statusLabel}
                              </span>
                            </td>
                            <td className="p-3 text-center">
                              {sheetsSt === 'synced' ? (
                                <span className="text-[11px] font-bold text-[#4ade80] inline-flex items-center gap-1">
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Tersinkron</span>
                                </span>
                              ) : sheetsSt === 'failed' ? (
                                <button
                                  type="button"
                                  disabled={retryingSessionId === s.sessionId}
                                  onClick={() => void handleRetrySessionSync(s.sessionId)}
                                  className="px-btn px-btn-red px-2 py-1 text-[10px] cursor-pointer"
                                >
                                  {retryingSessionId === s.sessionId ? 'Retry...' : 'Gagal • Coba Lagi'}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={retryingSessionId === s.sessionId}
                                  onClick={() => void handleRetrySessionSync(s.sessionId)}
                                  className="px-btn px-btn-dark px-2 py-1 text-[10px] cursor-pointer"
                                >
                                  Sinkronkan
                                </button>
                              )}
                            </td>
                            <td className="p-3 text-right">
                              <button
                                type="button"
                                onClick={() => {
                                  setDetailSession(s);
                                  sounds.playClick();
                                }}
                                className="px-btn px-btn-gold px-2.5 py-1 text-[11px] inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>Detail</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* MENU 8: PENGATURAN INTEGRASI */}
        {currentMenu === 'settings' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-7 px-card p-5 space-y-4">
              <div className="flex items-center gap-2 border-b-2 border-[#6d28d9] pb-3">
                <Key className="w-5 h-5 text-[#facc15]" />
                <h2 className="text-sm sm:text-base font-bold text-[#facc15]">
                  PENGATURAN INTEGRASI &amp; KEAMANAN
                </h2>
              </div>

              <form onSubmit={(e) => void handleSaveIntegrationSettings(e)} className="space-y-4 text-xs">
                <div>
                  <label className="block font-bold text-[#facc15] mb-1">
                    URL Google Apps Script Web App (/exec):
                  </label>
                  <input
                    type="url"
                    value={googleSheetsWebAppUrl}
                    onChange={(e) => setGoogleSheetsWebAppUrl(e.target.value)}
                    placeholder="https://script.google.com/macros/s/AKfycb.../exec"
                    className="px-input w-full px-3 py-2 font-mono text-xs"
                  />
                </div>

                <div>
                  <label className="block font-bold text-[#facc15] mb-1">
                    Link / ID Google Spreadsheet (Opsional untuk tombol pintas &amp; ID termasker):
                  </label>
                  <input
                    type="text"
                    value={spreadsheetIdOrUrl}
                    onChange={(e) => setSpreadsheetIdOrUrl(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/... atau ID Spreadsheet"
                    className="px-input w-full px-3 py-2 font-mono text-xs"
                  />
                  {settingsDto?.maskedSpreadsheetId && (
                    <div className="text-[11px] text-[#4ade80] mt-1">
                      Spreadsheet ID aktif: <code>{settingsDto.maskedSpreadsheetId}</code>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block font-bold text-[#f472b6] mb-1">
                    Token Rahasia Apps Script (Opsional, Write-Only):
                  </label>
                  <input
                    type="password"
                    value={sheetsSharedSecretInput}
                    onChange={(e) => setSheetsSharedSecretInput(e.target.value)}
                    placeholder={
                      settingsDto?.sheetsSharedSecretConfigured
                        ? 'Sudah tersimpan aman (isi baru untuk mengganti)'
                        : 'Kosongkan jika tidak memakai PIRATE_SYNC_TOKEN'
                    }
                    className="px-input w-full px-3 py-2 text-xs"
                  />
                </div>

                <label className="px-subcard p-3 flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoSyncSheets}
                    onChange={(e) => setAutoSyncSheets(e.target.checked)}
                    className="accent-[#facc15]"
                  />
                  <span>
                    Sinkronkan otomatis BankSoal &amp; RekapNilai ke Google Sheets saat paket diterbitkan atau siswa menjawab
                  </span>
                </label>

                <div className="pt-2 border-t border-[#4c1d95]">
                  <label className="block font-bold text-[#cbb7eb] mb-1">
                    Ubah PIN Portal Guru (minimal 6 karakter, disimpan terenkripsi):
                  </label>
                  {settingsDto?.pinManagedByEnv ? (
                    <div className="px-subcard p-2.5 text-[11px] text-[#4ade80]">
                      PIN saat ini dikelola melalui Secret server (<code>TEACHER_PIN</code>) sehingga tetap persisten saat container restart. Ubah nilai <code>TEACHER_PIN</code> di panel Secrets hosting jika ingin mengganti PIN.
                    </div>
                  ) : (
                    <input
                      type="password"
                      value={newPinInput}
                      onChange={(e) => setNewPinInput(e.target.value)}
                      placeholder="Kosongkan jika tidak ingin mengubah PIN (min. 6 karakter)"
                      className="px-input w-full px-3 py-2 text-xs"
                    />
                  )}
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={isSavingSettings}
                    className="px-btn px-btn-gold px-5 py-2.5 text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <Save className="w-4 h-4" />
                    <span>{isSavingSettings ? 'Menyimpan...' : 'Simpan Pengaturan'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleTestSheetsConnection()}
                    disabled={isTestingSheets}
                    className="px-btn px-btn-purple px-4 py-2.5 text-xs cursor-pointer"
                  >
                    {isTestingSheets ? 'Menguji...' : 'Uji Koneksi Sheets'}
                  </button>
                </div>
              </form>
            </div>

            {/* Google Drive OAuth Status Panel */}
            <div className="lg:col-span-5 px-card-pink p-5 space-y-4">
              <h3 className="text-sm font-bold text-[#f472b6]">
                STATUS GOOGLE DRIVE &amp; PICKER
              </h3>
              <div className="px-subcard p-3.5 space-y-2 text-xs">
                <div>
                  Status Konfigurasi Aplikasi:{' '}
                  <strong className={driveConfig.configured ? 'text-[#4ade80]' : 'text-[#fca5a5]'}>
                    {driveConfig.configured ? 'Siap (OAuth Terkonfigurasi)' : 'Belum Terkonfigurasi'}
                  </strong>
                </div>
                <div>
                  Status Sesi Akun Google:{' '}
                  <strong className={hasDriveToken ? 'text-[#4ade80]' : 'text-[#facc15]'}>
                    {hasDriveToken && driveConnectedEmail
                      ? `Terhubung (${driveConnectedEmail})`
                      : 'Belum Masuk'}
                  </strong>
                </div>
                <p className="text-[11px] text-[#cbb7eb]">
                  Aplikasi hanya meminta izin per file yang dipilih melalui Google Picker (<code>drive.file</code>) dan menyimpan token sementara di memori browser saja. Sinkronisasi Google Sheets menggunakan Web App Apps Script pribadi Anda tanpa meminta izin Drive penuh maupun akses Gmail/Calendar.
                </p>
              </div>

              {driveConfig.configured && (
                <div className="flex flex-wrap gap-2">
                  {!hasDriveToken ? (
                    <button
                      type="button"
                      onClick={() => {
                        void signInGoogleDrive().catch((err) => {
                          setBannerNotice({
                            type: 'error',
                            text:
                              err instanceof Error
                                ? err.message
                                : 'Gagal menghubungkan akun Google Drive. Pastikan pop-up diizinkan.',
                          });
                        });
                      }}
                      className="px-btn px-btn-gold px-4 py-2 text-xs cursor-pointer"
                    >
                      Hubungkan Akun Google Drive
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void signOutGoogleDrive()}
                      className="px-btn px-btn-red px-4 py-2 text-xs cursor-pointer"
                    >
                      Putuskan Koneksi Drive
                    </button>
                  )}
                </div>
              )}

              <div className="px-subcard p-3.5 space-y-2 text-xs">
                <div className="font-bold text-[#facc15]">Panduan &amp; Template Code.gs</div>
                <p className="text-[11px] text-[#cbb7eb]">
                  Lihat panduan instalasi lengkap Google Sheets + Google Apps Script atau salin template Code.gs terbaru.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setShowGuideModal(true)}
                    className="px-btn px-btn-dark px-3.5 py-1.5 text-xs cursor-pointer"
                  >
                    Buka Panduan Instalasi
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyCodeGs}
                    className="px-btn px-btn-pink px-3.5 py-1.5 text-xs cursor-pointer"
                  >
                    {copiedScript ? 'Code.gs Disalin!' : 'Salin Code.gs'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* SESSION DETAIL MODAL */}
      {detailSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
          <div className="px-card-gold w-full max-w-3xl p-5 space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b-2 border-[#6d28d9]">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-[#facc15]">
                  DETAIL JAWABAN: {detailSession.student.name} ({detailSession.student.grade})
                </h3>
                <div className="text-[11px] text-[#cbb7eb]">
                  {detailSession.packageTitle} • Skor: {detailSession.totalScore}/
                  {detailSession.maxPossibleScore} ({detailSession.percentageScore}%)
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDetailSession(null)}
                aria-label="Tutup detail jawaban siswa"
                className="px-btn px-btn-pink p-1.5 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {Object.values(detailSession.answers || {})
                .sort((a, b) => a.questionNumber - b.questionNumber)
                .map((ans) => {
                  const qObj = getQuestionForAnswer(detailSession, ans.questionId);
                  const isPending =
                    ans.gradingStatus === 'pending_review' && !ans.isGradedManually;

                  return (
                    <div key={ans.questionId} className="px-subcard p-3.5 space-y-2 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-bold text-[#facc15]">
                          Soal #{ans.questionNumber} ({getQuestionTypeLabel(ans.questionType)})
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[#4ade80]">
                            {ans.scoreAwarded}/{ans.maxPoints} Poin
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setGradingModalData({ session: detailSession, question: qObj })
                            }
                            className="px-btn px-btn-gold px-2.5 py-1 text-[10px] cursor-pointer"
                          >
                            {isPending ? 'Koreksi Manual' : 'Ubah Nilai'}
                          </button>
                        </div>
                      </div>
                      <p className="text-[#f8f4ff] font-medium">{qObj.prompt}</p>
                      <div className="bg-[#090312] border border-[#4c1d95] p-2">
                        <span className="text-[#f472b6] font-bold">Jawaban Siswa: </span>
                        <span>
                          {(() => {
                            const raw = ans.answerText || '';
                            if (raw.startsWith('{') || raw.startsWith('[')) {
                              try {
                                const parsed = JSON.parse(raw);
                                if (Array.isArray(parsed)) return parsed.join(', ');
                                if (parsed && typeof parsed === 'object') {
                                  return Object.entries(parsed as Record<string, unknown>)
                                    .map(([k, v]) => `${k} -> ${String(v)}`)
                                    .join(' | ');
                                }
                              } catch {
                                // fall through
                              }
                            }
                            return raw;
                          })()}
                        </span>
                      </div>
                    </div>
                  );
                })}
            </div>

            <div className="flex justify-end pt-2 border-t border-[#6d28d9]">
              <button
                type="button"
                onClick={() => setDetailSession(null)}
                className="px-btn px-btn-dark px-5 py-2 text-xs cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MANUAL GRADING MODAL */}
      {gradingModalData && (
        <ManualScoringModal
          session={gradingModalData.session}
          question={gradingModalData.question}
          onClose={() => setGradingModalData(null)}
          onScoreUpdated={(updatedSession) => {
            setSessions((prev) =>
              prev.map((s) => (s.sessionId === updatedSession.sessionId ? updatedSession : s))
            );
            setDetailSession((prev) =>
              prev && prev.sessionId === updatedSession.sessionId ? updatedSession : prev
            );
          }}
        />
      )}

      {/* GUIDE MODAL */}
      {showGuideModal && (
        <GoogleSheetsGuideModal onClose={() => setShowGuideModal(false)} />
      )}

      {/* DELETE PACKAGE CONFIRM MODAL */}
      {confirmDeletePkgId && (
        <PixelConfirmModal
          title="Hapus Paket Bank Soal?"
          message="Paket soal beserta daftar soal di dalamnya akan dihapus permanen dari Bank Soal."
          confirmLabel="Ya, Hapus Paket"
          onConfirm={() => void handleConfirmDeletePackage()}
          onCancel={() => setConfirmDeletePkgId(null)}
        />
      )}
    </div>
  );
};
