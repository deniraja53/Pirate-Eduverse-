/**
 * Teacher Dashboard Component for Pirate Academy 3D (V4)
 * Real-time backend synchronization via REST + WebSocket (/ws):
 * - Secure PIN auth -> Bearer session token
 * - Package Manager: Draft vs Published, quiz versioning, 1-to-1 Chest Mapping viewer, BankSoal sync
 * - PDF Extractor (<= 2 MB) with Scanned PDF/OCR support & interactive editor
 * - Live Student Results Recap: all required columns, multi-filters, sorting, detail modal, manual grading, CSV export
 * - Google Sheets Relay Settings & Code.gs V4 setup guide
 * Created by Deni Raja99
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Shield,
  BookOpen,
  FileText,
  Users,
  Settings,
  Plus,
  Trash2,
  Edit3,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Download,
  Copy,
  MapPin,
  ArrowLeft,
  Key,
  RefreshCw,
  Rocket,
  Eye,
  Search,
  CloudUpload,
  Clock,
  X,
  ArrowUp,
  ArrowDown,
  Save,
  Layers,
} from 'lucide-react';
import type { Question, QuestionPackage, StudentSession } from '../types/game';
import { CHEST_PRESETS } from '../services/storage';
import { CHEST_ZONE_LABELS } from '../game/ChestConfig';
import { GOOGLE_APPS_SCRIPT_CODE, testSheetsConnection } from '../services/sheetsApi';
import {
  connectRealtimeWs,
  deleteTeacherPackageApi,
  fetchTeacherPackagesApi,
  fetchTeacherSessionsApi,
  fetchTeacherSettingsApi,
  getTeacherToken,
  loginTeacherApi,
  publishTeacherPackageApi,
  retrySessionSheetsSyncApi,
  saveTeacherPackageApi,
  setTeacherToken,
  syncPackageToSheetsApi,
  updateTeacherSettingsApi,
} from '../services/apiClient';
import { PdfImporter } from './PdfImporter';
import { ManualScoringModal } from './ManualScoringModal';
import { sounds } from '../services/audio';

interface TeacherDashboardProps {
  onBackToGame: () => void;
}

export const TeacherDashboard: React.FC<TeacherDashboardProps> = ({ onBackToGame }) => {
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(Boolean(getTeacherToken()));
  const [enteredPin, setEnteredPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Backend data state
  const [packages, setPackages] = useState<QuestionPackage[]>([]);
  const [activePackageId, setActivePackageId] = useState<string>('');
  const [selectedPkgId, setSelectedPkgId] = useState<string>('');
  const [sessions, setSessions] = useState<StudentSession[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string>('');
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [bannerNotice, setBannerNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Teacher settings state (never stores/exposes PIN plaintext)
  const [googleSheetsWebAppUrl, setGoogleSheetsWebAppUrl] = useState('');
  const [autoSyncSheets, setAutoSyncSheets] = useState(true);
  const [newPinInput, setNewPinInput] = useState('');

  // UI Tabs
  const [currentTab, setCurrentTab] = useState<'packages' | 'pdf' | 'recap' | 'sheets'>('packages');

  // Modals
  const [editingQuestion, setEditingQuestion] = useState<{
    pkgId: string;
    question: Question;
    isNew: boolean;
  } | null>(null);
  const [detailSession, setDetailSession] = useState<StudentSession | null>(null);
  const [gradingModalData, setGradingModalData] = useState<{
    session: StudentSession;
    question: Question;
  } | null>(null);

  // Sheets & sync UI feedback
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);
  const [retryingSessionId, setRetryingSessionId] = useState<string | null>(null);
  const [isSyncingPackage, setIsSyncingPackage] = useState(false);
  const [isPublishingPkg, setIsPublishingPkg] = useState(false);

  // Recap Filters & Sorting
  const [filterGrade, setFilterGrade] = useState('Semua');
  const [filterQuizId, setFilterQuizId] = useState('Semua');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'time_desc' | 'time_asc' | 'score_desc' | 'score_asc'>('time_desc');

  const loadAllTeacherData = useCallback(async () => {
    if (!getTeacherToken()) {
      setIsAuthenticated(false);
      return;
    }
    setIsLoadingData(true);
    try {
      const [pkgRes, sesRes, setRes] = await Promise.all([
        fetchTeacherPackagesApi(),
        fetchTeacherSessionsApi(),
        fetchTeacherSettingsApi(),
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
        setGoogleSheetsWebAppUrl(setRes.settings.googleSheetsWebAppUrl || '');
        setAutoSyncSheets(setRes.settings.autoSyncSheets);
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

  // Real-time WebSocket updates for live student answers, completion, and Sheets sync status
  useEffect(() => {
    if (!isAuthenticated) return;

    const disconnect = connectRealtimeWs((evt) => {
      if (evt.type === 'session:updated') {
        const updated = evt.payload;
        setSessions((prev) => {
          const exists = prev.some((s) => s.sessionId === updated.sessionId);
          if (exists) {
            return prev.map((s) => (s.sessionId === updated.sessionId ? updated : s));
          }
          return [updated, ...prev];
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
        setPackages((prev) => {
          const exists = prev.some((p) => p.id === pub.id);
          return exists ? prev.map((p) => (p.id === pub.id ? pub : p)) : [pub, ...prev];
        });
        setLastUpdatedAt(new Date().toISOString());
      }
    });

    return disconnect;
  }, [isAuthenticated]);

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoggingIn || !enteredPin.trim()) return;
    setIsLoggingIn(true);
    setPinError('');

    try {
      const res = await loginTeacherApi(enteredPin.trim());
      if (res.success) {
        setIsAuthenticated(true);
        setEnteredPin('');
        sounds.playClick();
      } else {
        setPinError(res.message || 'PIN salah! Silakan coba lagi.');
        sounds.playWrong();
      }
    } catch {
      setPinError('Gagal terhubung ke server autentikasi.');
      sounds.playWrong();
    } finally {
      setIsLoggingIn(false);
    }
  };

  const selectedPackage = useMemo(
    () => packages.find((p) => p.id === selectedPkgId) || packages[0] || null,
    [packages, selectedPkgId]
  );

  // Persist package edits to backend as draft
  const persistPackageDraft = async (updatedPkg: QuestionPackage) => {
    const res = await saveTeacherPackageApi(updatedPkg);
    if (res.success && res.package) {
      setPackages((prev) => prev.map((p) => (p.id === res.package!.id ? res.package! : p)));
      setBannerNotice({ type: 'success', text: res.message });
      return res.package;
    } else {
      setBannerNotice({ type: 'error', text: res.message || 'Gagal menyimpan paket soal.' });
      return null;
    }
  };

  const handlePublishSelected = async (createNewVersion: boolean) => {
    if (!selectedPackage || isPublishingPkg) return;
    setIsPublishingPkg(true);
    setBannerNotice(null);

    try {
      const res = await publishTeacherPackageApi(selectedPackage.id, createNewVersion);
      if (res.success && res.package) {
        await loadAllTeacherData();
        setSelectedPkgId(res.package.id);
        sounds.playVictory();
        const extraSheet = res.sheetsSyncResult
          ? ` | BankSoal Sheets: ${res.sheetsSyncResult.message}`
          : '';
        setBannerNotice({
          type: 'success',
          text: `${res.message}${extraSheet}`,
        });
      } else {
        sounds.playWrong();
        setBannerNotice({ type: 'error', text: res.message });
      }
    } finally {
      setIsPublishingPkg(false);
    }
  };

  const handleCreateEmptyDraft = async () => {
    const res = await saveTeacherPackageApi({
      title: `Paket Kuis Baru (${new Date().toLocaleDateString('id-ID')})`,
      description: 'Paket kuis baru dibuat oleh guru di Portal Guru.',
      gradeLevel: 'Kelas 5 SD',
      isSequential: false,
      showInstantFeedback: true,
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
          chestPosition: CHEST_PRESETS[0],
          locationName: CHEST_PRESETS[0].name,
        },
      ],
    });
    if (res.success && res.package) {
      setPackages((prev) => [res.package!, ...prev]);
      setSelectedPkgId(res.package.id);
      setBannerNotice({ type: 'success', text: 'Draf paket kuis baru berhasil dibuat.' });
      sounds.playClick();
    }
  };

  const handleDeletePackage = async (pkgId: string) => {
    if (!window.confirm('Hapus paket soal ini dari daftar?')) return;
    const res = await deleteTeacherPackageApi(pkgId);
    if (res.success && res.packages) {
      setPackages(res.packages);
      setActivePackageId(res.activePackageId || '');
      setSelectedPkgId(res.packages[0]?.id || '');
      setBannerNotice({ type: 'success', text: 'Paket soal dihapus.' });
    } else {
      setBannerNotice({ type: 'error', text: res.message || 'Gagal menghapus paket.' });
    }
  };

  const handleSyncPackageSheets = async () => {
    if (!selectedPackage || isSyncingPackage) return;
    setIsSyncingPackage(true);
    try {
      const res = await syncPackageToSheetsApi(selectedPackage.id);
      setBannerNotice({
        type: res.success ? 'success' : 'error',
        text: res.message,
      });
    } finally {
      setIsSyncingPackage(false);
    }
  };

  const handleAddNewQuestion = () => {
    if (!selectedPackage) return;
    const nextNum = selectedPackage.questions.length + 1;
    const preset = CHEST_PRESETS[(nextNum - 1) % CHEST_PRESETS.length];
    setEditingQuestion({
      pkgId: selectedPackage.id,
      question: {
        id: `q-${Date.now()}-${nextNum}`,
        number: nextNum,
        type: 'multiple_choice',
        prompt: '',
        options: [
          { id: 'A', text: '' },
          { id: 'B', text: '' },
          { id: 'C', text: '' },
          { id: 'D', text: '' },
        ],
        correctAnswer: undefined,
        points: 10,
        chestPosition: preset,
        locationName: preset.name,
      },
      isNew: true,
    });
  };

  const handleSaveQuestion = async (q: Question) => {
    if (!selectedPackage) return;
    let newQuestions = [...selectedPackage.questions];
    if (editingQuestion?.isNew) {
      newQuestions.push(q);
    } else {
      newQuestions = newQuestions.map((item) => (item.id === q.id ? q : item));
    }
    newQuestions = newQuestions.map((item, idx) => ({ ...item, number: idx + 1 }));
    await persistPackageDraft({ ...selectedPackage, questions: newQuestions });
    setEditingQuestion(null);
    sounds.playCorrect();
  };

  const handleMoveQuestionInPkg = async (index: number, dir: -1 | 1) => {
    if (!selectedPackage) return;
    const target = index + dir;
    if (target < 0 || target >= selectedPackage.questions.length) return;
    const next = [...selectedPackage.questions];
    const tmp = next[index];
    next[index] = next[target];
    next[target] = tmp;
    await persistPackageDraft({
      ...selectedPackage,
      questions: next.map((q, idx) => ({ ...q, number: idx + 1 })),
    });
    sounds.playClick();
  };

  const handleDeleteQuestion = async (qId: string) => {
    if (!selectedPackage) return;
    if (!window.confirm('Hapus soal peti ini?')) return;
    const newQuestions = selectedPackage.questions
      .filter((q) => q.id !== qId)
      .map((item, idx) => ({ ...item, number: idx + 1 }));
    await persistPackageDraft({ ...selectedPackage, questions: newQuestions });
    sounds.playClick();
  };

  // Filtered & sorted sessions for Recap
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
      if (qLower && !s.student.name.toLowerCase().includes(qLower) && !(s.student.studentId || '').toLowerCase().includes(qLower)) {
        return false;
      }
      if (filterDateFrom) {
        const d = s.startTime.slice(0, 10);
        if (d < filterDateFrom) return false;
      }
      if (filterDateTo) {
        const d = s.startTime.slice(0, 10);
        if (d > filterDateTo) return false;
      }
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
    const totalQuestions = pkg?.questions.length || s.chestMappings?.length || Object.keys(s.answers || {}).length || 0;
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
      setBannerNotice({ type: 'error', text: 'Belum ada data sesi siswa sesuai filter untuk diekspor.' });
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
    link.setAttribute('download', `Rekap_Pirate_Academy_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleRetrySync = async (sessionId: string) => {
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

  const handleSaveSettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSavingSettings(true);
    try {
      const payload: {
        googleSheetsWebAppUrl: string;
        autoSyncSheets: boolean;
        newPin?: string;
      } = {
        googleSheetsWebAppUrl: googleSheetsWebAppUrl.trim(),
        autoSyncSheets,
      };
      if (newPinInput.trim().length >= 4) {
        payload.newPin = newPinInput.trim();
      }
      const res = await updateTeacherSettingsApi(payload);
      if (res.success) {
        setNewPinInput('');
        sounds.playCorrect();
        setBannerNotice({ type: 'success', text: res.message });
      } else {
        setBannerNotice({ type: 'error', text: res.message });
      }
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleTestConnection = async () => {
    if (!googleSheetsWebAppUrl.trim()) {
      setTestResult({
        success: false,
        message: 'Masukkan URL Google Apps Script terlebih dahulu!',
      });
      return;
    }
    setIsTesting(true);
    setTestResult(null);
    // Save URL first so backend has it too, then test
    await updateTeacherSettingsApi({ googleSheetsWebAppUrl: googleSheetsWebAppUrl.trim() });
    const res = await testSheetsConnection(googleSheetsWebAppUrl.trim());
    setIsTesting(false);
    setTestResult(res);
  };

  const handleCopyScript = () => {
    void navigator.clipboard.writeText(GOOGLE_APPS_SCRIPT_CODE);
    setCopiedScript(true);
    sounds.playClick();
    setTimeout(() => setCopiedScript(false), 2500);
  };

  // 1. PIN GATE VIEW
  if (!isAuthenticated) {
    return (
      <div className="relative w-full h-full min-h-screen flex items-center justify-center p-4 bg-slate-950 text-white select-none">
        <div className="w-full max-w-md bg-gradient-to-b from-slate-900 to-slate-950 border-2 border-amber-500/70 rounded-3xl p-6 sm:p-8 shadow-2xl text-center">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/20 border border-amber-400 mx-auto mb-4 flex items-center justify-center text-amber-400">
            <Shield className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold font-pirate text-amber-400">
            Portal Guru & Pengawas
          </h2>
          <p className="text-xs text-slate-400 mt-1 mb-6">
            Autentikasi diperlukan untuk mengunggah PDF soal, menerbitkan kuis 3D, mengoreksi nilai siswa, dan sinkronisasi Google Sheets.
          </p>

          <form onSubmit={handlePinSubmit} className="space-y-4">
            <input
              type="password"
              value={enteredPin}
              onChange={(e) => setEnteredPin(e.target.value)}
              placeholder="Masukkan PIN Guru"
              className="w-full px-4 py-3 bg-slate-900 border-2 border-amber-600/60 rounded-xl text-center text-lg font-bold tracking-widest text-amber-300 placeholder-slate-500 focus:outline-none focus:border-amber-400"
              autoFocus
            />

            {pinError && (
              <div className="p-2.5 bg-red-950/80 border border-red-500 text-red-200 rounded-xl text-xs font-semibold">
                {pinError}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-amber-950 font-bold text-sm uppercase font-cinzel tracking-wider shadow-lg cursor-pointer transition-colors"
            >
              {isLoggingIn ? 'Memverifikasi...' : 'Masuk Dashboard Guru'}
            </button>

            <button
              type="button"
              onClick={onBackToGame}
              className="text-xs text-slate-400 hover:text-white cursor-pointer"
            >
              ← Kembali ke Layar Siswa
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Detail modal session questions helper
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

  // 2. MAIN DASHBOARD
  return (
    <div className="relative w-full h-full min-h-screen bg-slate-950 text-white select-none flex flex-col">
      {/* Top Bar */}
      <header className="bg-slate-900/95 border-b border-amber-600/40 px-4 sm:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-400 flex items-center justify-center text-amber-400">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-bold font-pirate text-amber-400 tracking-wide">
              Portal Guru • Pirate Academy 3D
            </h1>
            <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-2">
              <span>Deni Raja99</span>
              <span>•</span>
              <span className="text-emerald-400 font-semibold">Live WebSocket Aktif</span>
              {lastUpdatedAt && (
                <>
                  <span>•</span>
                  <span>
                    Terakhir diperbarui: {new Date(lastUpdatedAt).toLocaleTimeString('id-ID')}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadAllTeacherData()}
            disabled={isLoadingData}
            className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingData ? 'animate-spin' : ''}`} />
            <span>Segarkan</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setTeacherToken('');
              setIsAuthenticated(false);
            }}
            className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs cursor-pointer"
          >
            Keluar PIN
          </button>

          <button
            type="button"
            onClick={onBackToGame}
            className="py-2 px-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-amber-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-md"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Kembali ke Game</span>
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-slate-900/50 border-b border-slate-800 px-4 sm:px-8 flex items-center gap-2 overflow-x-auto text-xs font-bold">
        <button
          type="button"
          onClick={() => setCurrentTab('packages')}
          className={`py-3 px-4 border-b-2 flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap ${
            currentTab === 'packages'
              ? 'border-amber-400 text-amber-300'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>Paket Soal & Peti ({packages.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setCurrentTab('pdf')}
          className={`py-3 px-4 border-b-2 flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap ${
            currentTab === 'pdf'
              ? 'border-amber-400 text-amber-300'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Unggah PDF (≤ 2 MB)</span>
        </button>

        <button
          type="button"
          onClick={() => setCurrentTab('recap')}
          className={`py-3 px-4 border-b-2 flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap ${
            currentTab === 'recap'
              ? 'border-amber-400 text-amber-300'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Rekap Nilai Siswa ({sessions.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setCurrentTab('sheets')}
          className={`py-3 px-4 border-b-2 flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap ${
            currentTab === 'sheets'
              ? 'border-amber-400 text-amber-300'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <Settings className="w-4 h-4" />
          <span>Google Sheets & Pengaturan</span>
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-4 sm:p-8 overflow-y-auto max-w-7xl mx-auto w-full space-y-5">
        {bannerNotice && (
          <div
            className={`p-3.5 rounded-2xl border text-xs font-semibold flex items-center justify-between gap-2 ${
              bannerNotice.type === 'success'
                ? 'bg-emerald-950/70 border-emerald-500/60 text-emerald-200'
                : 'bg-red-950/70 border-red-500/60 text-red-200'
            }`}
          >
            <div className="flex items-center gap-2">
              {bannerNotice.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              )}
              <span>{bannerNotice.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setBannerNotice(null)}
              className="p-1 hover:bg-white/10 rounded cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* TAB 1: PACKAGES & CHEST MAPPING */}
        {currentTab === 'packages' && (
          <div className="space-y-6">
            {/* Package Selector Strip */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                  <Layers className="w-4 h-4" />
                  <span>Pilih Paket Soal:</span>
                </label>
                <select
                  value={selectedPackage?.id || ''}
                  onChange={(e) => setSelectedPkgId(e.target.value)}
                  className="bg-slate-950 border border-slate-700 px-3 py-2 rounded-xl text-xs font-semibold text-white max-w-md"
                >
                  {packages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id === activePackageId ? '★ [AKTIF DI GAME] ' : ''}
                      {p.isPublished ? '[Terbit] ' : '[Draf] '}
                      {p.title} ({p.questions.length} Soal)
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentTab('pdf')}
                  className="py-2 px-3.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Impor PDF (≤ 2 MB)</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleCreateEmptyDraft()}
                  className="py-2 px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Buat Draf Baru</span>
                </button>
              </div>
            </div>

            {selectedPackage ? (
              <>
                {/* Package Header Card */}
                <div className="bg-slate-900 border border-amber-600/40 rounded-3xl p-5 sm:p-6 shadow-xl flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl sm:text-2xl font-bold font-pirate text-amber-300">
                        {selectedPackage.title}
                      </h2>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                          selectedPackage.id === activePackageId
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-500/60'
                            : selectedPackage.isPublished
                            ? 'bg-sky-950 text-sky-300 border-sky-500/50'
                            : 'bg-amber-950 text-amber-300 border-amber-500/50'
                        }`}
                      >
                        {selectedPackage.id === activePackageId
                          ? `AKTIF DI GAME 3D (v${selectedPackage.version || 1})`
                          : selectedPackage.isPublished
                          ? `Diterbitkan (v${selectedPackage.version || 1})`
                          : 'Draf Belum Diterbitkan'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300">{selectedPackage.description}</p>
                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-amber-400 font-semibold pt-1">
                      <span>quizId: <code className="text-slate-300">{selectedPackage.id}</code></span>
                      <span>•</span>
                      <span>Jenjang: {selectedPackage.gradeLevel}</span>
                      <span>•</span>
                      <span>{selectedPackage.questions.length} Peti Soal</span>
                      {selectedPackage.sourcePdfName && (
                        <>
                          <span>•</span>
                          <span>Sumber PDF: {selectedPackage.sourcePdfName}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handlePublishSelected(false)}
                      disabled={isPublishingPkg}
                      className="py-2 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-md"
                    >
                      <Rocket className="w-3.5 h-3.5" />
                      <span>
                        {selectedPackage.id === activePackageId
                          ? 'Terbitkan Ulang / Aktifkan'
                          : 'Publikasikan ke Game 3D'}
                      </span>
                    </button>

                    {selectedPackage.isPublished && (
                      <button
                        type="button"
                        onClick={() => void handlePublishSelected(true)}
                        disabled={isPublishingPkg}
                        className="py-2 px-3.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs cursor-pointer"
                        title="Terbitkan sebagai quizId versi baru agar riwayat nilai versi sebelumnya tetap utuh"
                      >
                        Terbitkan Versi Baru
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => void handleSyncPackageSheets()}
                      disabled={isSyncingPackage}
                      className="py-2 px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      <CloudUpload className="w-3.5 h-3.5" />
                      <span>{isSyncingPackage ? 'Menyinkron...' : 'Sync BankSoal'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleAddNewQuestion}
                      className="py-2 px-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-amber-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Tambah Soal</span>
                    </button>

                    {packages.length > 1 && (
                      <button
                        type="button"
                        onClick={() => void handleDeletePackage(selectedPackage.id)}
                        className="p-2 rounded-xl bg-slate-800 hover:bg-red-950 text-red-400 cursor-pointer"
                        title="Hapus Paket Soal"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Chest-to-Question Mapping Summary Table */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-amber-300 uppercase tracking-wider">
                      Pemetaan Peti 3D → Soal (Strict ID Mapping)
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Setiap peti terhubung permanen berdasarkan <code>questionId</code> &amp; <code>quizId</code>
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-[11px]">
                    {(selectedPackage.chestMappings || []).map((m) => (
                      <div
                        key={m.chestId}
                        className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-amber-300">
                            {m.chestId} → Soal #{m.chestNumber}
                          </div>
                          <div className="text-slate-300 truncate">{m.locationName}</div>
                          {m.zoneType && (
                            <div className="text-[10px] text-emerald-400/90 truncate">
                              {CHEST_ZONE_LABELS[m.zoneType]}
                              {m.position ? ` (${m.position.x}, ${m.position.z})` : ''}
                            </div>
                          )}
                        </div>
                        <code className="text-[10px] text-slate-500 shrink-0">{m.questionId}</code>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Questions List */}
                <div className="space-y-3">
                  {selectedPackage.questions.length > 29 && (
                    <div className="bg-amber-950/70 border border-amber-500/60 text-amber-200 px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>
                        Paket berisi {selectedPackage.questions.length} soal. Seluruh {selectedPackage.questions.length} peti akan ditempatkan secara proporsional di sepanjang 4 zona eksplorasi peta 3D tanpa ada soal yang dibuang.
                      </span>
                    </div>
                  )}

                  {selectedPackage.questions.map((q, idx) => (
                    <div
                      key={`${q.id}-${idx}`}
                      className="bg-slate-900/80 border border-slate-800 hover:border-amber-600/40 p-4 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-all"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <span className="w-9 h-9 rounded-xl bg-amber-600 text-white font-pirate font-bold text-lg flex items-center justify-center shrink-0">
                          {q.number}
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-amber-400 mb-1">
                            <span className="bg-slate-800 px-2 py-0.5 rounded text-slate-200">
                              {q.type === 'multiple_choice'
                                ? 'Pilihan Ganda'
                                : q.type === 'short_answer'
                                ? 'Isian Singkat'
                                : 'Esai'}
                            </span>
                            <span>•</span>
                            <span>{q.points} Poin</span>
                            <span>•</span>
                            <span className="text-slate-400 flex items-center gap-1">
                              <MapPin className="w-3 h-3 text-amber-400" />
                              {q.locationName || `Pos #${q.number}`}
                            </span>
                            {q.needsReview && (
                              <span className="bg-amber-950 border border-amber-500/60 text-amber-300 px-2 py-0.5 rounded text-[10px]">
                                Perlu Cek Guru
                              </span>
                            )}
                          </div>
                          {q.instructions && (
                            <p className="text-[11px] text-amber-200/80 italic mb-0.5">
                              Instruksi: {q.instructions}
                            </p>
                          )}
                          <p className="text-sm text-slate-100 font-medium">{q.prompt}</p>
                          {q.type === 'multiple_choice' && (
                            <div className="mt-1 text-xs text-slate-400">
                              Kunci Jawaban:{' '}
                              <strong className={q.correctAnswer ? 'text-emerald-400' : 'text-amber-300'}>
                                {q.correctAnswer || 'Belum ditentukan (Menunggu review guru)'}
                              </strong>
                            </div>
                          )}
                          {q.explanation && (
                            <div className="mt-1 text-xs text-sky-300/90">
                              <strong>Pembahasan:</strong> {q.explanation}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                        <button
                          type="button"
                          onClick={() => void handleMoveQuestionInPkg(idx, -1)}
                          disabled={idx === 0}
                          className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 cursor-pointer"
                          title="Geser Atas"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleMoveQuestionInPkg(idx, 1)}
                          disabled={idx === selectedPackage.questions.length - 1}
                          className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 cursor-pointer"
                          title="Geser Bawah"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setEditingQuestion({
                              pkgId: selectedPackage.id,
                              question: { ...q },
                              isNew: false,
                            })
                          }
                          className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 cursor-pointer"
                          title="Edit Soal"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteQuestion(q.id)}
                          className="p-2 rounded-xl bg-slate-800 hover:bg-red-950 text-red-400 cursor-pointer"
                          title="Hapus Soal"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-10 text-center text-slate-400 text-xs">
                Belum ada paket soal. Klik "Impor PDF" atau "Buat Draf Baru".
              </div>
            )}
          </div>
        )}

        {/* TAB 2: PDF IMPORTER */}
        {currentTab === 'pdf' && (
          <PdfImporter
            onSavedPackage={(pkg, published) => {
              void loadAllTeacherData().then(() => {
                setSelectedPkgId(pkg.id);
                setCurrentTab('packages');
                setBannerNotice({
                  type: 'success',
                  text: published
                    ? `Paket "${pkg.title}" diterbitkan ke Game 3D dengan ${pkg.questions.length} peti!`
                    : `Draf paket "${pkg.title}" disimpan ke Portal Guru.`,
                });
              });
            }}
            onCancel={() => setCurrentTab('packages')}
          />
        )}

        {/* TAB 3: STUDENT RESULTS RECAP */}
        {currentTab === 'recap' && (
          <div className="space-y-5">
            {/* Filter & Export Controls */}
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-amber-300">
                    Rekapitulasi Nilai Siswa (Live Server &amp; Google Sheets)
                  </h3>
                  <p className="text-xs text-slate-400">
                    Menampilkan {filteredSessions.length} dari {sessions.length} sesi siswa.
                    Perubahan jawaban siswa muncul otomatis via WebSocket.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="py-2 px-4 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer shadow-md"
                >
                  <Download className="w-4 h-4" />
                  <span>Ekspor CSV</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 text-xs">
                {/* Search Name */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Cari nama / ID siswa..."
                    className="w-full pl-8 pr-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-500"
                  />
                </div>

                {/* Filter Grade */}
                <select
                  value={filterGrade}
                  onChange={(e) => setFilterGrade(e.target.value)}
                  className="bg-slate-950 border border-slate-700 px-3 py-2 rounded-xl text-slate-200 font-semibold"
                >
                  <option value="Semua">Semua Kelas</option>
                  {uniqueGrades.map((gr) => (
                    <option key={gr} value={gr}>
                      {gr}
                    </option>
                  ))}
                </select>

                {/* Filter Quiz */}
                <select
                  value={filterQuizId}
                  onChange={(e) => setFilterQuizId(e.target.value)}
                  className="bg-slate-950 border border-slate-700 px-3 py-2 rounded-xl text-slate-200 font-semibold"
                >
                  <option value="Semua">Semua Kuis</option>
                  {uniqueQuizzesInSessions.map(([qId, qTitle]) => (
                    <option key={qId} value={qId}>
                      {qTitle}
                    </option>
                  ))}
                </select>

                {/* Date Range */}
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={filterDateFrom}
                    onChange={(e) => setFilterDateFrom(e.target.value)}
                    className="w-1/2 bg-slate-950 border border-slate-700 px-2 py-2 rounded-xl text-[11px] text-slate-200"
                    title="Dari Tanggal"
                  />
                  <input
                    type="date"
                    value={filterDateTo}
                    onChange={(e) => setFilterDateTo(e.target.value)}
                    className="w-1/2 bg-slate-950 border border-slate-700 px-2 py-2 rounded-xl text-[11px] text-slate-200"
                    title="Sampai Tanggal"
                  />
                </div>

                {/* Sort */}
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                  className="bg-slate-950 border border-slate-700 px-3 py-2 rounded-xl text-slate-200 font-semibold"
                >
                  <option value="time_desc">Urutkan: Waktu Terbaru</option>
                  <option value="time_asc">Urutkan: Waktu Terlama</option>
                  <option value="score_desc">Urutkan: Nilai Tertinggi</option>
                  <option value="score_asc">Urutkan: Nilai Terendah</option>
                </select>
              </div>
            </div>

            {/* Recap Table */}
            {filteredSessions.length === 0 ? (
              <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-12 text-center text-slate-400 text-xs">
                Belum ada data pengerjaan siswa yang cocok dengan filter.
              </div>
            ) : (
              <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-950 text-slate-400 uppercase font-bold border-b border-slate-800 text-[11px]">
                      <tr>
                        <th className="py-3.5 px-4">Waktu Mulai</th>
                        <th className="py-3.5 px-4">Siswa</th>
                        <th className="py-3.5 px-4">Kelas</th>
                        <th className="py-3.5 px-4">Kuis</th>
                        <th className="py-3.5 px-4">Progres Soal</th>
                        <th className="py-3.5 px-4">Skor &amp; Nilai</th>
                        <th className="py-3.5 px-4">Status</th>
                        <th className="py-3.5 px-4">Google Sheets</th>
                        <th className="py-3.5 px-4 text-center">Detail</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {filteredSessions.map((s) => {
                        const m = computeSessionMetrics(s);
                        const syncSt = s.sheetsSyncStatus || (s.syncedToSheets ? 'synced' : 'idle');
                        return (
                          <tr key={s.sessionId} className="hover:bg-slate-800/40">
                            <td className="py-3.5 px-4 text-slate-400 whitespace-nowrap">
                              {new Date(s.startTime).toLocaleString('id-ID')}
                            </td>
                            <td className="py-3.5 px-4">
                              <div className="font-bold text-white">{s.student.name}</div>
                              <div className="text-[10px] text-slate-500 font-mono">
                                {s.student.studentId || s.sessionId}
                              </div>
                            </td>
                            <td className="py-3.5 px-4 text-amber-300 font-semibold whitespace-nowrap">
                              {s.student.grade}
                            </td>
                            <td className="py-3.5 px-4">
                              <div className="font-semibold text-slate-200 max-w-[180px] truncate">
                                {s.packageTitle}
                              </div>
                              <div className="text-[10px] text-slate-500 font-mono">{s.packageId}</div>
                            </td>
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <div className="font-semibold text-sky-300">
                                Selesai: {m.completedCount}/{m.totalQuestions}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                <span className="text-emerald-400">✓ {m.correctCount}</span> •{' '}
                                <span className="text-red-400">✕ {m.wrongCount}</span> •{' '}
                                <span className="text-slate-400">Sisa {m.remainingCount}</span>
                              </div>
                            </td>
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <div className="font-bold text-amber-300">
                                {s.totalScore} / {s.maxPossibleScore}
                              </div>
                              <span
                                className={`inline-block mt-0.5 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                                  s.percentageScore >= 80
                                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                                    : s.percentageScore >= 60
                                    ? 'bg-amber-950 text-amber-300 border border-amber-500/40'
                                    : 'bg-red-950 text-red-300 border border-red-500/40'
                                }`}
                              >
                                {s.percentageScore}%
                              </span>
                            </td>
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <span
                                className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${
                                  m.statusType === 'pending_review'
                                    ? 'bg-amber-950/70 text-amber-300 border-amber-500/50'
                                    : m.statusType === 'completed'
                                    ? 'bg-emerald-950/70 text-emerald-300 border-emerald-500/50'
                                    : 'bg-sky-950/70 text-sky-300 border-sky-500/50'
                                }`}
                              >
                                {m.statusLabel}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <div className="flex flex-col gap-1">
                                <span
                                  className={`text-[10px] font-bold flex items-center gap-1 ${
                                    syncSt === 'synced'
                                      ? 'text-emerald-400'
                                      : syncSt === 'syncing'
                                      ? 'text-sky-400'
                                      : syncSt === 'failed'
                                      ? 'text-red-400'
                                      : 'text-slate-400'
                                  }`}
                                  title={s.sheetsSyncError || ''}
                                >
                                  {syncSt === 'synced' ? (
                                    <>
                                      <CheckCircle2 className="w-3.5 h-3.5" /> Tersinkron
                                    </>
                                  ) : syncSt === 'syncing' ? (
                                    <>
                                      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Mengirim...
                                    </>
                                  ) : syncSt === 'failed' ? (
                                    <>
                                      <AlertTriangle className="w-3.5 h-3.5" /> Gagal
                                    </>
                                  ) : (
                                    <>
                                      <Clock className="w-3.5 h-3.5" /> Belum Sinkron
                                    </>
                                  )}
                                </span>

                                <button
                                  type="button"
                                  disabled={retryingSessionId === s.sessionId}
                                  onClick={() => void handleRetrySync(s.sessionId)}
                                  className="text-[10px] text-amber-300 hover:underline text-left cursor-pointer disabled:opacity-50"
                                >
                                  {retryingSessionId === s.sessionId ? 'Menyinkron...' : 'Sinkronkan Ulang'}
                                </button>
                              </div>
                            </td>
                            <td className="py-3.5 px-4 text-center whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => setDetailSession(s)}
                                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>Rincian &amp; Nilai</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: GOOGLE SHEETS & SETTINGS */}
        {currentTab === 'sheets' && (
          <div className="space-y-6">
            <form
              onSubmit={(e) => void handleSaveSettings(e)}
              className="bg-slate-900 border border-amber-600/40 rounded-3xl p-6 space-y-4"
            >
              <div>
                <h3 className="text-lg font-bold font-pirate text-amber-300">
                  Integrasi Google Sheets V4 (Siswa, BankSoal, Hasil, Rekap)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Server backend menyinkronkan data secara otomatis dan real-time ke spreadsheet Anda
                  dengan kunci anti-duplikasi (idempotent upsert) dan mekanisme retry otomatis.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-amber-300 mb-1">
                  URL Web App Google Apps Script:
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="url"
                    value={googleSheetsWebAppUrl}
                    onChange={(e) => setGoogleSheetsWebAppUrl(e.target.value)}
                    placeholder="https://script.google.com/macros/s/.../exec"
                    className="flex-1 px-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="button"
                    onClick={() => void handleTestConnection()}
                    disabled={isTesting}
                    className="py-2.5 px-5 bg-amber-500 hover:bg-amber-400 text-amber-950 font-bold text-xs rounded-xl cursor-pointer transition-colors shadow-md shrink-0"
                  >
                    {isTesting ? 'Menguji...' : 'Uji Koneksi'}
                  </button>
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoSyncSheets}
                  onChange={(e) => setAutoSyncSheets(e.target.checked)}
                  className="accent-amber-500"
                />
                <span>
                  Aktifkan sinkronisasi real-time otomatis setiap siswa menjawab peti, selesai ujian, atau saat guru menerbitkan soal
                </span>
              </label>

              {testResult && (
                <div
                  className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                    testResult.success
                      ? 'bg-emerald-950/80 border-emerald-500 text-emerald-200'
                      : 'bg-red-950/80 border-red-500 text-red-200'
                  }`}
                >
                  {testResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                  )}
                  <span>{testResult.message}</span>
                </div>
              )}

              <div className="pt-2 border-t border-slate-800 space-y-2">
                <h4 className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5" />
                  <span>Ganti PIN Portal Guru (Opsional, minimal 4 karakter)</span>
                </h4>
                <input
                  type="password"
                  value={newPinInput}
                  onChange={(e) => setNewPinInput(e.target.value)}
                  placeholder="Kosongkan jika tidak ingin mengganti PIN"
                  className="max-w-sm w-full px-4 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isSavingSettings}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  <span>{isSavingSettings ? 'Menyimpan...' : 'Simpan Pengaturan'}</span>
                </button>
              </div>
            </form>

            {/* Code.gs Script Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-bold text-amber-300">
                    Kode Google Apps Script V4 Siap Pakai (Code.gs)
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    Mendukung 4 tab otomatis (<code>Siswa</code>, <code>BankSoal</code>, <code>Hasil</code>, <code>Rekap</code>), formula ringkasan otomatis, serta LockService anti-duplikasi.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCopyScript}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copiedScript ? 'Tersalin!' : 'Salin Kode Code.gs'}</span>
                </button>
              </div>

              <div className="p-3 bg-slate-950/70 border border-amber-700/30 rounded-xl text-[11px] text-amber-200/90 space-y-1">
                <div>
                  <strong>Catatan Izin Web App Google:</strong> Atur <em>Execute as: Me</em> dan{' '}
                  <em>Who has access: Anyone</em> agar server aplikasi dapat mengirim POST JSON tanpa layar login interaktif. URL skrip hanya disimpan di backend server dan tidak pernah diekspos ke browser siswa.
                </div>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-[11px] text-slate-300 max-h-64 overflow-y-auto whitespace-pre">
                {GOOGLE_APPS_SCRIPT_CODE}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* PER-STUDENT ANSWER DETAIL MODAL */}
      {detailSession && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs select-none">
          <div className="bg-slate-900 border-2 border-amber-500/80 rounded-3xl p-6 max-w-3xl w-full text-white space-y-4 max-h-[90vh] flex flex-col shadow-2xl">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-lg font-bold font-pirate text-amber-300">
                  Rincian Jawaban Siswa: {detailSession.student.name} ({detailSession.student.grade})
                </h3>
                <p className="text-xs text-slate-400">
                  Kuis: <strong>{detailSession.packageTitle}</strong> • Skor Total:{' '}
                  <strong className="text-amber-300">
                    {detailSession.totalScore}/{detailSession.maxPossibleScore} ({detailSession.percentageScore}%)
                  </strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailSession(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1 text-xs">
              {Object.values(detailSession.answers || {}).length === 0 ? (
                <div className="p-8 text-center text-slate-400">
                  Siswa ini baru memulai sesi dan belum mengirimkan jawaban peti mana pun.
                </div>
              ) : (
                Object.values(detailSession.answers)
                  .sort((a, b) => a.questionNumber - b.questionNumber)
                  .map((ans) => {
                    const qObj = getQuestionForAnswer(detailSession, ans.questionId);
                    const isPending =
                      ans.gradingStatus === 'pending_review' && !ans.isGradedManually;
                    return (
                      <div
                        key={ans.questionId}
                        className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded bg-amber-600 text-white font-bold">
                              Soal #{ans.questionNumber}
                            </span>
                            <span className="text-slate-400 uppercase font-semibold text-[10px]">
                              {ans.questionType}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                isPending
                                  ? 'bg-amber-950 text-amber-300 border border-amber-500/40'
                                  : ans.isCorrect
                                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                                  : 'bg-red-950 text-red-300 border border-red-500/40'
                              }`}
                            >
                              {isPending
                                ? 'Menunggu Koreksi Guru'
                                : ans.isGradedManually
                                ? 'Dinilai Manual'
                                : ans.isCorrect
                                ? 'Benar'
                                : 'Salah'}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="font-bold text-amber-300">
                              Nilai: {ans.scoreAwarded} / {ans.maxPoints}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setGradingModalData({
                                  session: detailSession,
                                  question: qObj,
                                })
                              }
                              className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-amber-950 font-bold text-[11px] cursor-pointer"
                            >
                              {isPending ? 'Beri Nilai' : 'Edit Nilai'}
                            </button>
                          </div>
                        </div>

                        <p className="text-slate-300 font-medium">{qObj.prompt}</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                          <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-800">
                            <span className="text-[10px] text-slate-400 block">Jawaban Siswa:</span>
                            <span className="text-white font-semibold">{ans.answerText}</span>
                          </div>
                          <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-800">
                            <span className="text-[10px] text-slate-400 block">Kunci / Catatan:</span>
                            <span className="text-emerald-300 font-semibold">
                              {ans.correctAnswerSnapshot || 'Koreksi manual / terbuka'}
                            </span>
                          </div>
                        </div>
                        {ans.teacherFeedback && (
                          <div className="text-[11px] text-amber-200 bg-amber-950/30 p-2 rounded-lg">
                            <strong>Catatan Guru ({ans.gradedBy || 'Guru'}):</strong>{' '}
                            {ans.teacherFeedback}
                          </div>
                        )}
                      </div>
                    );
                  })
              )}
            </div>
          </div>
        </div>
      )}

      {/* QUESTION EDITING MODAL */}
      {editingQuestion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs select-none">
          <div className="bg-slate-900 border-2 border-amber-500 rounded-3xl p-6 max-w-xl w-full text-white space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold font-pirate text-amber-400">
              {editingQuestion.isNew
                ? 'Tambah Soal Peti Baru'
                : `Edit Peti #${editingQuestion.question.number}`}
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1">Tipe Soal:</label>
                <select
                  value={editingQuestion.question.type}
                  onChange={(e) =>
                    setEditingQuestion({
                      ...editingQuestion,
                      question: {
                        ...editingQuestion.question,
                        type: e.target.value as Question['type'],
                      },
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-700 px-3 py-2 rounded-xl text-white font-semibold"
                >
                  <option value="multiple_choice">Pilihan Ganda (Otomatis)</option>
                  <option value="short_answer">Isian Singkat</option>
                  <option value="essay">Esai (Koreksi Guru)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">
                  Instruksi Khusus (Opsional):
                </label>
                <input
                  type="text"
                  value={editingQuestion.question.instructions || ''}
                  onChange={(e) =>
                    setEditingQuestion({
                      ...editingQuestion,
                      question: {
                        ...editingQuestion.question,
                        instructions: e.target.value,
                      },
                    })
                  }
                  placeholder="Contoh: Pilih jawaban yang paling tepat..."
                  className="w-full bg-slate-950 border border-slate-700 px-3 py-2 rounded-xl text-white"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">Pertanyaan:</label>
                <textarea
                  value={editingQuestion.question.prompt}
                  onChange={(e) =>
                    setEditingQuestion({
                      ...editingQuestion,
                      question: { ...editingQuestion.question, prompt: e.target.value },
                    })
                  }
                  rows={3}
                  className="w-full bg-slate-950 border border-slate-700 px-3 py-2 rounded-xl text-white focus:outline-none focus:border-amber-400"
                />
              </div>

              {editingQuestion.question.type === 'multiple_choice' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-slate-300 font-bold">
                      Pilihan Jawaban &amp; Kunci (
                      {editingQuestion.question.correctAnswer || 'Belum ditentukan'}):
                    </label>
                    {editingQuestion.question.correctAnswer && (
                      <button
                        type="button"
                        onClick={() =>
                          setEditingQuestion({
                            ...editingQuestion,
                            question: {
                              ...editingQuestion.question,
                              correctAnswer: undefined,
                            },
                          })
                        }
                        className="text-[11px] text-amber-300 underline cursor-pointer"
                      >
                        Kosongkan Kunci
                      </button>
                    )}
                  </div>
                  {['A', 'B', 'C', 'D'].map((letter, idx) => {
                    const optText = editingQuestion.question.options?.[idx]?.text || '';
                    const isKey = editingQuestion.question.correctAnswer === letter;
                    return (
                      <div key={letter} className="flex items-center gap-2">
                        <span className="w-6 font-bold text-amber-400">{letter}.</span>
                        <input
                          type="text"
                          value={optText}
                          onChange={(e) => {
                            const opts = [...(editingQuestion.question.options || [])];
                            opts[idx] = { id: letter, text: e.target.value };
                            setEditingQuestion({
                              ...editingQuestion,
                              question: { ...editingQuestion.question, options: opts },
                            });
                          }}
                          className="flex-1 bg-slate-950 border border-slate-700 px-3 py-1.5 rounded-xl text-white"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setEditingQuestion({
                              ...editingQuestion,
                              question: {
                                ...editingQuestion.question,
                                correctAnswer: isKey ? undefined : letter,
                                needsReview: false,
                              },
                            })
                          }
                          className={`px-3 py-1 rounded-xl text-xs font-bold cursor-pointer ${
                            isKey ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {isKey ? 'Kunci ✓' : 'Set Kunci'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {editingQuestion.question.type === 'short_answer' && (
                <div>
                  <label className="block text-slate-300 font-bold mb-1">
                    Kata Kunci Otomatis (pisahkan koma, opsional):
                  </label>
                  <input
                    type="text"
                    value={(editingQuestion.question.keywords || []).join(', ')}
                    onChange={(e) => {
                      const kws = e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean);
                      setEditingQuestion({
                        ...editingQuestion,
                        question: {
                          ...editingQuestion.question,
                          keywords: kws.length > 0 ? kws : undefined,
                        },
                      });
                    }}
                    className="w-full bg-slate-950 border border-slate-700 px-3 py-2 rounded-xl text-white"
                  />
                </div>
              )}

              {editingQuestion.question.type === 'essay' && (
                <div>
                  <label className="block text-slate-300 font-bold mb-1">
                    Rubrik Penilaian Esai:
                  </label>
                  <textarea
                    value={editingQuestion.question.essayRubric || ''}
                    onChange={(e) =>
                      setEditingQuestion({
                        ...editingQuestion,
                        question: { ...editingQuestion.question, essayRubric: e.target.value },
                      })
                    }
                    rows={2}
                    placeholder="Kriteria penilaian esai..."
                    className="w-full bg-slate-950 border border-slate-700 px-3 py-2 rounded-xl text-white"
                  />
                </div>
              )}

              <div>
                <label className="block text-slate-300 font-bold mb-1">
                  Pembahasan Edukatif Umum (Opsional):
                </label>
                <textarea
                  value={editingQuestion.question.explanation || ''}
                  onChange={(e) =>
                    setEditingQuestion({
                      ...editingQuestion,
                      question: {
                        ...editingQuestion.question,
                        explanation: e.target.value,
                      },
                    })
                  }
                  rows={2}
                  placeholder="Penjelasan konsep atau alasan jawaban yang tampil setelah siswa menjawab..."
                  className="w-full bg-slate-950 border border-slate-700 px-3 py-2 rounded-xl text-white"
                />
              </div>

              {editingQuestion.question.type !== 'essay' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-300 font-bold mb-1">
                      Penjelasan Jika Benar (Opsional):
                    </label>
                    <textarea
                      value={editingQuestion.question.correctExplanation || ''}
                      onChange={(e) =>
                        setEditingQuestion({
                          ...editingQuestion,
                          question: {
                            ...editingQuestion.question,
                            correctExplanation: e.target.value,
                          },
                        })
                      }
                      rows={2}
                      placeholder="Misal: Tepat! 15 km + 25 km = 40 km."
                      className="w-full bg-slate-950 border border-slate-700 px-3 py-2 rounded-xl text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-300 font-bold mb-1">
                      Penjelasan Jika Salah (Opsional):
                    </label>
                    <textarea
                      value={editingQuestion.question.incorrectExplanation || ''}
                      onChange={(e) =>
                        setEditingQuestion({
                          ...editingQuestion,
                          question: {
                            ...editingQuestion.question,
                            incorrectExplanation: e.target.value,
                          },
                        })
                      }
                      rows={2}
                      placeholder="Misal: Jumlahkan kedua jarak tempuh agar mendapat totalnya."
                      className="w-full bg-slate-950 border border-slate-700 px-3 py-2 rounded-xl text-white"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-slate-300 font-bold mb-1">Bobot Nilai (Poin):</label>
                <input
                  type="number"
                  min={1}
                  value={editingQuestion.question.points}
                  onChange={(e) =>
                    setEditingQuestion({
                      ...editingQuestion,
                      question: {
                        ...editingQuestion.question,
                        points: Math.max(1, Number(e.target.value) || 10),
                      },
                    })
                  }
                  className="w-24 bg-slate-950 border border-slate-700 px-3 py-1.5 rounded-xl text-white"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setEditingQuestion(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-bold rounded-xl cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void handleSaveQuestion(editingQuestion.question)}
                className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-amber-950 text-xs font-bold rounded-xl cursor-pointer shadow-md"
              >
                Simpan Soal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MANUAL SCORING MODAL */}
      {gradingModalData && (
        <ManualScoringModal
          session={gradingModalData.session}
          question={gradingModalData.question}
          onClose={() => setGradingModalData(null)}
          onScoreUpdated={(updated) => {
            setSessions((prev) =>
              prev.map((s) => (s.sessionId === updated.sessionId ? updated : s))
            );
            setDetailSession((prev) =>
              prev && prev.sessionId === updated.sessionId ? updated : prev
            );
          }}
        />
      )}
    </div>
  );
};
