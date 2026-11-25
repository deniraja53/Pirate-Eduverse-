/**
 * Main Application Component: Pirate Academy: Treasure Quest (V4 Full-Stack)
 * Fetches active published quiz from backend (/api/quiz/active), persists student sessions
 * and chest answers in real time (/api/sessions/*), and listens for live WebSocket updates.
 * Never fabricates dummy quiz fallback if no published quiz exists.
 * Created by Deni Raja99
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CoverScreen } from './components/CoverScreen';
import { PirateGameCanvas } from './game/PirateGameCanvas';
import { LoginScreen } from './components/LoginScreen';
import { LoadingScreen } from './components/LoadingScreen';
import { InstructionScreen } from './components/InstructionScreen';
import { QUESTION_PANEL_ASSET, QuestionPanel } from './components/QuestionPanel';
import { GameHUD } from './components/GameHUD';
import { PauseMenu } from './components/PauseMenu';
import { ResultScreen } from './components/ResultScreen';
import { TeacherDashboard } from './teacher/TeacherDashboard';
import {
  normalizeAllowedGrade,
  type ChestPlacementMeta,
  type Question,
  type QuestionPackage,
  type SavedPlayerPose,
  type StudentAnswer,
  type StudentSession,
} from './types/game';
import { DEFAULT_GAME_CONFIG, type GameConfig } from './game/GameConfig';
import type { RaycastDebugData } from './game/MapEnvironment';
import { createInitialMiniMapState, type MiniMapLiveState } from './game/MiniMapTypes';
import {
  clearActiveRecoveryState,
  getActiveRecoveryState,
  saveActiveRecoveryState,
  saveStudentSession,
  updateLocalRecoveryPose,
} from './services/storage';
import { sounds } from './services/audio';
import {
  completeStudentSessionApi,
  connectRealtimeWs,
  fetchActiveQuiz,
  getStudentSessionApi,
  startStudentSessionApi,
  submitStudentAnswerApi,
  updateSessionProgressApi,
} from './services/apiClient';

export default function App() {
  const [view, setView] = useState<'cover' | 'login' | 'loading' | 'game' | 'result' | 'teacher'>('cover');
  const [showInstructions, setShowInstructions] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  // Unified Game & Camera Configuration
  const [gameConfig, setGameConfig] = useState<GameConfig>({ ...DEFAULT_GAME_CONFIG });
  const [debugData, setDebugData] = useState<RaycastDebugData | null>(null);
  const [chestPlacements, setChestPlacements] = useState<ChestPlacementMeta[]>([]);

  // Active published question package from backend (null if none published)
  const [questionPackage, setQuestionPackage] = useState<QuestionPackage | null>(null);
  const [quizLoadError, setQuizLoadError] = useState<string>('');
  const [quizFetchState, setQuizFetchState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [isStartingSession, setIsStartingSession] = useState(false);

  // Loading & Pending Student State (Biodata -> Loading -> 3D Game)
  const [pendingStudent, setPendingStudent] = useState<{ name: string; grade: string } | null>(null);
  const [loadingAttempt, setLoadingAttempt] = useState(0);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState('Menyiapkan pelayaran...');
  const [loadingError, setLoadingError] = useState('');
  const [assetsPreloaded, setAssetsPreloaded] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const loadingStartedAtRef = useRef<number>(0);

  // Active Student Game Session & Safe Refresh Recovery State
  const [currentSession, setCurrentSession] = useState<StudentSession | null>(null);
  const [isRecoveringSession, setIsRecoveringSession] = useState<boolean>(() => {
    const rec = getActiveRecoveryState();
    return Boolean(rec && rec.activeGameplay);
  });
  const restoringSessionRef = useRef<StudentSession | null>(null);
  const restorePoseRef = useRef<SavedPlayerPose | null>(null);
  const latestPoseRef = useRef<SavedPlayerPose | null>(null);
  const lastServerPoseSyncAtRef = useRef<number>(0);
  const viewRef = useRef(view);
  viewRef.current = view;

  // Active Chest Question being answered + duration tracking + V10 Full Map & Coin VFX state
  const [activeQuestion, setActiveQuestion] = useState<Question | null>(null);
  const [isFullMapOpen, setIsFullMapOpen] = useState(false);
  const [coinRewardTrigger, setCoinRewardTrigger] = useState<{
    questionId: string;
    nonce: number;
  } | null>(null);
  const chestOpenedAtRef = useRef<number>(Date.now());
  const miniMapStateRef = useRef<MiniMapLiveState>(createInitialMiniMapState());

  const preloadImageAsset = useCallback(
    (src: string) =>
      new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(`Gagal memuat aset gambar: ${src}`));
        img.src = src;
      }),
    []
  );

  // Virtual Controls for Touch Screens
  const [joystickVector, setJoystickVector] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [interactTrigger, setInteractTrigger] = useState<number>(0);
  const [jumpTrigger, setJumpTrigger] = useState<number>(0);

  const loadActivePackageFromServer = useCallback(async () => {
    setQuizFetchState((prev) => (prev === 'ready' ? 'ready' : 'loading'));
    try {
      const res = await fetchActiveQuiz();
      if (res.serverConfirmed && res.hasActiveQuiz && res.activePackage) {
        setQuestionPackage(res.activePackage);
        setQuizLoadError('');
        setQuizFetchState('ready');
      } else if (res.serverConfirmed && !res.hasActiveQuiz) {
        setQuestionPackage(null);
        setQuizLoadError(
          res.message ||
            'Belum ada paket soal aktif yang diterbitkan oleh guru. Silakan buka Portal Guru untuk menerbitkan kuis.'
        );
        setQuizFetchState('empty');
      } else {
        setQuestionPackage(null);
        setQuizLoadError(
          res.message || 'Gagal memuat paket soal aktif dari server API.'
        );
        setQuizFetchState('error');
      }
    } catch {
      setQuestionPackage(null);
      setQuizLoadError('Tidak dapat terhubung ke server API untuk memuat paket soal aktif.');
      setQuizFetchState('error');
    }
  }, []);

  // Safe Refresh Recovery Check on Initial Mount
  useEffect(() => {
    const recovery = getActiveRecoveryState();
    if (!recovery || !recovery.activeGameplay) {
      setIsRecoveringSession(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const [sessionRes, quizRes] = await Promise.all([
          getStudentSessionApi(recovery.sessionId),
          fetchActiveQuiz(),
        ]);
        if (cancelled) return;

        const session = sessionRes.session;
        const activePkg = quizRes.activePackage;

        const maxSessionAgeMs = 12 * 60 * 60 * 1000;
        const lastUpdatedMs = Date.parse(session?.updatedAt || session?.startTime || '');
        const isExpired = !Number.isFinite(lastUpdatedMs) || Date.now() - lastUpdatedMs > maxSessionAgeMs;
        const sessionPkgVer = session?.packageVersion ?? 1;
        const activePkgVer = activePkg?.version ?? 1;

        const isValidToResume =
          Boolean(sessionRes.success && session && !session.isCompleted) &&
          Boolean(quizRes.success && activePkg) &&
          session!.packageId === activePkg!.id &&
          sessionPkgVer === activePkgVer &&
          (!recovery.studentId || recovery.studentId === session!.student.studentId) &&
          !isExpired;

        if (!isValidToResume || !session || !activePkg) {
          clearActiveRecoveryState();
          setIsRecoveringSession(false);
          return;
        }

        // Choose the fresher valid SavedPlayerPose between local cache and server record
        const isFinitePose = (p?: SavedPlayerPose | null): p is SavedPlayerPose =>
          Boolean(
            p &&
              Number.isFinite(p.x) &&
              Number.isFinite(p.y) &&
              Number.isFinite(p.z) &&
              Number.isFinite(p.rotationY)
          );

        const localPose = isFinitePose(recovery.lastPosition) ? recovery.lastPosition : null;
        const serverPose = isFinitePose(session.lastPosition) ? session.lastPosition : null;
        let chosenPose: SavedPlayerPose | null = serverPose || localPose;
        if (localPose && serverPose) {
          const localTime = Date.parse(localPose.updatedAt || '');
          const serverTime = Date.parse(serverPose.updatedAt || '');
          chosenPose =
            Number.isFinite(localTime) && (!Number.isFinite(serverTime) || localTime >= serverTime)
              ? localPose
              : serverPose;
        }

        restoringSessionRef.current = session;
        restorePoseRef.current = chosenPose;
        latestPoseRef.current = chosenPose;

        setPendingStudent({ name: session.student.name, grade: session.student.grade });
        setQuestionPackage(activePkg);
        setCurrentSession(session);
        saveStudentSession(session);
        saveActiveRecoveryState({
          sessionId: session.sessionId,
          studentId: session.student.studentId || '',
          studentName: session.student.name,
          studentGrade: session.student.grade,
          packageId: activePkg.id,
          packageVersion: activePkg.version ?? 1,
          activeGameplay: true,
          lastPosition: chosenPose || undefined,
          savedAt: new Date().toISOString(),
        });

        setSceneReady(false);
        setAssetsPreloaded(false);
        setLoadingError('');
        setLoadingProgress(35);
        setLoadingStatus('Memulihkan progres & posisi petualanganmu...');
        loadingStartedAtRef.current = Date.now();
        setLoadingAttempt((prev) => prev + 1);
        setIsRecoveringSession(false);
        setView('loading');
      } catch {
        if (!cancelled) {
          clearActiveRecoveryState();
          setIsRecoveringSession(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Load active quiz initially & whenever entering cover/login
  useEffect(() => {
    if (!isRecoveringSession && (view === 'cover' || view === 'login')) {
      void loadActivePackageFromServer();
    }
  }, [view, isRecoveringSession, loadActivePackageFromServer]);

  // Pirate Soundtrack Lifecycle: plays continuously during 'game' (even when QuestionPanel/PauseMenu opens)
  // and fades out smoothly when leaving gameplay to cover, login, result, or teacher portal.
  useEffect(() => {
    if (view === 'game') {
      sounds.startGameplayMusic();
    } else if (view === 'cover' || view === 'login' || view === 'result' || view === 'teacher') {
      sounds.stopGameplayMusic(view === 'cover' || view === 'login');
    }
  }, [view]);

  // Real-time WebSocket subscription for quiz publish and current session sync updates
  useEffect(() => {
    const disconnect = connectRealtimeWs((evt) => {
      if (evt.type === 'quiz:published') {
        // Never tear down an active student's 3D world mid-run; apply live outside gameplay
        if (viewRef.current !== 'game' && viewRef.current !== 'loading') {
          setQuestionPackage(evt.payload);
          setQuizLoadError('');
          setQuizFetchState('ready');
        }
      } else if (evt.type === 'session:updated') {
        setCurrentSession((prev) =>
          prev && prev.sessionId === evt.payload.sessionId ? evt.payload : prev
        );
      } else if (evt.type === 'sheets:sync_status') {
        const st = evt.payload;
        setCurrentSession((prev) =>
          prev && prev.sessionId === st.sessionId
            ? {
                ...prev,
                sheetsSyncStatus: st.status,
                syncedToSheets: st.syncedToSheets,
                lastSyncedAt: st.lastSyncedAt || prev.lastSyncedAt,
                sheetsSyncError: st.error,
              }
            : prev
        );
      }
    });
    return disconnect;
  }, []);

  // Flush final character pose on pagehide / tab hide during active gameplay
  useEffect(() => {
    if (view !== 'game' || !currentSession || currentSession.isCompleted) return;
    const sid = currentSession.sessionId;
    const flushPose = () => {
      const pose = latestPoseRef.current;
      if (!pose) return;
      updateLocalRecoveryPose(sid, pose);
      void updateSessionProgressApi(sid, pose, { keepalive: true });
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flushPose();
      }
    };
    window.addEventListener('pagehide', flushPose);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('pagehide', flushPose);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [view, currentSession?.sessionId, currentSession?.isCompleted]);

  const handlePlayerPoseChange = useCallback(
    (pose: SavedPlayerPose, immediateSync = false) => {
      latestPoseRef.current = pose;
      const sid = currentSession?.sessionId;
      if (!sid || currentSession?.isCompleted) return;

      updateLocalRecoveryPose(sid, pose);

      const now = Date.now();
      if (immediateSync || now - lastServerPoseSyncAtRef.current >= 4000) {
        lastServerPoseSyncAtRef.current = now;
        void updateSessionProgressApi(sid, pose, { keepalive: immediateSync });
      }
    },
    [currentSession?.sessionId, currentSession?.isCompleted]
  );

  // Transition from Biodata -> Loading Screen (validating biodata and guarding double-submit)
  const handleStartGame = (studentName: string, grade: string) => {
    if (isStartingSession || view === 'loading') return;
    const trimmedName = studentName.trim();
    const validGrade = normalizeAllowedGrade(grade);
    if (!trimmedName || !validGrade) {
      setQuizLoadError('Nama siswa dan pilihan kelas (IV, V, atau VI) harus valid.');
      return;
    }

    sounds.unlockAudio();
    clearActiveRecoveryState();
    restoringSessionRef.current = null;
    restorePoseRef.current = null;
    latestPoseRef.current = null;
    lastServerPoseSyncAtRef.current = 0;

    miniMapStateRef.current.ready = false;
    setPendingStudent({ name: trimmedName, grade: validGrade });
    setCurrentSession(null);
    setActiveQuestion(null);
    setIsFullMapOpen(false);
    setCoinRewardTrigger(null);
    setIsPaused(false);
    setSceneReady(false);
    setAssetsPreloaded(false);
    setLoadingError('');
    setLoadingProgress(12);
    setLoadingStatus('Mendaftarkan petualang & memuat paket soal...');
    loadingStartedAtRef.current = Date.now();
    setLoadingAttempt((prev) => prev + 1);
    setView('loading');
  };

  // Real Loading Orchestration: Session API (or Resumed Session) + Panel Image Preload -> Mount 3D Scene
  useEffect(() => {
    if (view !== 'loading' || !pendingStudent) return;

    let cancelled = false;
    setIsStartingSession(true);
    setLoadingError('');

    const timeoutId = window.setTimeout(() => {
      if (!cancelled) {
        setIsStartingSession(false);
        setLoadingError('Waktu pemuatan melebihi batas. Periksa koneksi Anda lalu coba lagi.');
      }
    }, 35000);

    const resumedSession = restoringSessionRef.current;

    if (resumedSession && questionPackage) {
      setLoadingProgress(35);
      setLoadingStatus('Memulihkan pulau 3D & posisi petualanganmu...');
      (async () => {
        try {
          await preloadImageAsset(QUESTION_PANEL_ASSET);
          if (cancelled) return;
          setAssetsPreloaded(true);
          setLoadingProgress(70);
          setLoadingStatus('Memuat pulau 3D & karakter petualang...');
        } catch {
          if (!cancelled) {
            setIsStartingSession(false);
            setLoadingError('Gagal memuat aset antarmuka permainan.');
          }
        }
      })();
    } else {
      setLoadingProgress(18);
      setLoadingStatus('Menyiapkan sesi siswa & bank soal...');
      (async () => {
        try {
          const [sessionRes] = await Promise.all([
            startStudentSessionApi(pendingStudent.name, pendingStudent.grade),
            preloadImageAsset(QUESTION_PANEL_ASSET),
          ]);

          if (cancelled) return;

          if (!sessionRes.success || !sessionRes.session || !sessionRes.activePackage) {
            setIsStartingSession(false);
            setLoadingError(
              sessionRes.message || 'Belum ada paket soal aktif yang diterbitkan oleh guru.'
            );
            return;
          }

          setQuestionPackage(sessionRes.activePackage);
          setCurrentSession(sessionRes.session);
          saveStudentSession(sessionRes.session);
          saveActiveRecoveryState({
            sessionId: sessionRes.session.sessionId,
            studentId: sessionRes.session.student.studentId || '',
            studentName: sessionRes.session.student.name,
            studentGrade: sessionRes.session.student.grade,
            packageId: sessionRes.activePackage.id,
            packageVersion: sessionRes.activePackage.version ?? 1,
            activeGameplay: true,
            savedAt: new Date().toISOString(),
          });
          setAssetsPreloaded(true);
          setLoadingProgress(65);
          setLoadingStatus('Memuat pulau 3D & karakter petualang...');
        } catch {
          if (!cancelled) {
            setIsStartingSession(false);
            setLoadingError('Gagal terhubung ke server untuk memulai sesi petualangan.');
          }
        }
      })();
    }

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [view, loadingAttempt, pendingStudent, preloadImageAsset]);

  // Complete transition to 'game' ONLY when BOTH backend/assets AND Three.js 3D scene are ready
  useEffect(() => {
    if (view !== 'loading' || !assetsPreloaded || !sceneReady || loadingError) return;

    setLoadingProgress(100);
    setLoadingStatus('Pulau & peti harta siap dijelajahi!');

    const elapsed = Date.now() - loadingStartedAtRef.current;
    const minCadenceMs = 950;
    const waitMs = Math.max(180, minCadenceMs - elapsed);

    const timer = window.setTimeout(() => {
      setIsStartingSession(false);
      restoringSessionRef.current = null;
      setView('game');
    }, waitMs);

    return () => window.clearTimeout(timer);
  }, [view, assetsPreloaded, sceneReady, loadingError]);

  const handleRetryLoading = () => {
    if (!pendingStudent) {
      clearActiveRecoveryState();
      setView('login');
      return;
    }
    if (!restoringSessionRef.current) {
      setCurrentSession(null);
    }
    setSceneReady(false);
    setAssetsPreloaded(false);
    setLoadingError('');
    setLoadingProgress(12);
    setLoadingStatus('Menghubungkan ulang ke pelayaran 3D...');
    loadingStartedAtRef.current = Date.now();
    setLoadingAttempt((prev) => prev + 1);
  };

  // Open chest interaction
  const handleOpenChest = (questionId: string) => {
    if (!questionPackage) return;
    const q = questionPackage.questions.find((item) => item.id === questionId);
    if (q) {
      setIsFullMapOpen(false);
      chestOpenedAtRef.current = Date.now();
      setActiveQuestion(q);
    }
  };

  // Submit student's answer authoritatively to backend API (zero fake/optimistic score claim)
  const handleSaveAnswer = async (ans: {
    questionId: string;
    answerText: string;
    isCorrect?: boolean;
    scoreAwarded: number;
  }): Promise<{
    success: boolean;
    message?: string;
    answer?: StudentAnswer;
    session?: StudentSession;
  }> => {
    if (!currentSession || !activeQuestion || !questionPackage) {
      return { success: false, message: 'Sesi atau soal aktif tidak ditemukan.' };
    }

    const chestMapping = questionPackage.chestMappings?.find(
      (m) => m.questionId === ans.questionId
    );
    const durationSeconds = Math.max(
      1,
      Math.round((Date.now() - chestOpenedAtRef.current) / 1000)
    );

    try {
      const res = await submitStudentAnswerApi(currentSession.sessionId, {
        questionId: ans.questionId,
        answerText: ans.answerText,
        chestId: chestMapping?.chestId,
        durationSeconds,
      });

      if (res.success && res.session && res.answer) {
        setCurrentSession(res.session);
        saveStudentSession(res.session);
        if (res.answer.isCorrect === true) {
          setCoinRewardTrigger((prev) => ({
            questionId: ans.questionId,
            nonce: (prev?.nonce ?? 0) + 1,
          }));
        }
        return {
          success: true,
          answer: res.answer,
          session: res.session,
        };
      }

      return {
        success: false,
        message: res.message || 'Server gagal menyimpan jawaban. Silakan coba lagi.',
      };
    } catch {
      return {
        success: false,
        message: 'Koneksi ke server terputus saat menyimpan jawaban. Klik kirim ulang.',
      };
    }
  };

  // Complete mission via backend API (triggers final grading & Google Sheets sync)
  const handleFinishQuest = async () => {
    if (!currentSession) return;
    setIsFullMapOpen(false);
    clearActiveRecoveryState();
    restorePoseRef.current = null;
    latestPoseRef.current = null;
    try {
      const res = await completeStudentSessionApi(currentSession.sessionId);
      if (res.success && res.session) {
        setCurrentSession(res.session);
        saveStudentSession(res.session);
        clearActiveRecoveryState();
      }
    } catch {
      const fallbackCompleted: StudentSession = {
        ...currentSession,
        isCompleted: true,
        endTime: new Date().toISOString(),
      };
      setCurrentSession(fallbackCompleted);
      saveStudentSession(fallbackCompleted);
      clearActiveRecoveryState();
    }
    setView('result');
  };

  const handleSceneReady = useCallback(() => {
    setSceneReady(true);
  }, []);

  const handleSceneError = useCallback((msg: string) => {
    setIsStartingSession(false);
    setLoadingError(msg);
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 font-sans">
      {/* INITIAL REFRESH RECOVERY CHECK OVERLAY */}
      {isRecoveringSession && (
        <LoadingScreen
          studentName={getActiveRecoveryState()?.studentName || 'Petualang'}
          studentGrade={getActiveRecoveryState()?.studentGrade || 'Kelas V'}
          progressPercent={22}
          statusMessage="Memeriksa & memulihkan progres sesi aktif..."
          onRetry={() => {
            clearActiveRecoveryState();
            setIsRecoveringSession(false);
          }}
          onBackToLogin={() => {
            clearActiveRecoveryState();
            setIsRecoveringSession(false);
            setView('login');
          }}
        />
      )}

      {/* 0. COVER SCREEN VIEW */}
      {!isRecoveringSession && view === 'cover' && (
        <CoverScreen
          onStart={() => setView('login')}
          onOpenTeacherDashboard={() => setView('teacher')}
        />
      )}

      {/* 1. LOGIN SCREEN VIEW */}
      {view === 'login' && (
        <LoginScreen
          activePackage={questionPackage}
          quizLoadError={quizLoadError}
          quizFetchState={quizFetchState}
          onRetryLoadQuiz={() => void loadActivePackageFromServer()}
          isStarting={isStartingSession}
          initialName={pendingStudent?.name}
          initialGrade={pendingStudent?.grade}
          onStartGame={(name, grade) => handleStartGame(name, grade)}
          onOpenInstructions={() => setShowInstructions(true)}
          onOpenTeacherDashboard={() => setView('teacher')}
          onBackToCover={() => setView('cover')}
        />
      )}

      {/* 2. GAMEPLAY VIEW (Pre-mounted silently during 'loading' so Three.js scene is genuinely ready) */}
      {(view === 'loading' || view === 'game') && currentSession && questionPackage && (
        <div className="relative w-full h-full">
          {/* 3D WebGL Canvas */}
          <PirateGameCanvas
            key={`${currentSession.sessionId}-${loadingAttempt}`}
            questionPackage={questionPackage}
            session={currentSession}
            onOpenChest={handleOpenChest}
            onFinishQuest={() => void handleFinishQuest()}
            onSceneReady={handleSceneReady}
            onSceneError={handleSceneError}
            isPaused={view === 'loading' || isPaused || !!activeQuestion || isFullMapOpen}
            gameConfig={gameConfig}
            onUpdateDebugData={setDebugData}
            onUpdateChestPlacements={setChestPlacements}
            miniMapStateRef={miniMapStateRef}
            virtualJoystickVector={joystickVector}
            virtualInteractTrigger={interactTrigger}
            virtualJumpTrigger={jumpTrigger}
            activeQuestionId={activeQuestion?.id ?? null}
            coinRewardTrigger={coinRewardTrigger}
            initialRestorePose={restorePoseRef.current}
            onPlayerPoseChange={handlePlayerPoseChange}
          />

          {/* Clean HUD Overlay (visible once loading finishes) */}
          {view === 'game' && (
            <GameHUD
              session={currentSession}
              questionPackage={questionPackage}
              gameConfig={gameConfig}
              onUpdateGameConfig={(key, val) =>
                setGameConfig((prev) => ({ ...prev, [key]: val }))
              }
              debugData={debugData}
              chestPlacements={chestPlacements}
              miniMapStateRef={miniMapStateRef}
              isFullMapOpen={isFullMapOpen}
              onOpenFullMap={() => {
                sounds.playClick();
                setIsFullMapOpen(true);
              }}
              onCloseFullMap={() => setIsFullMapOpen(false)}
              onPause={() => {
                setIsFullMapOpen(false);
                setIsPaused(true);
              }}
              onFinishQuest={() => void handleFinishQuest()}
              onOpenInstructions={() => setShowInstructions(true)}
              onVirtualJoystickMove={(v) => setJoystickVector(v)}
              onVirtualInteract={() => setInteractTrigger((prev) => prev + 1)}
              onVirtualJump={() => setJumpTrigger((prev) => prev + 1)}
            />
          )}

          {/* Question Panel */}
          {view === 'game' && activeQuestion && (
            <QuestionPanel
              key={activeQuestion.id}
              question={activeQuestion}
              existingAnswer={currentSession.answers[activeQuestion.id]}
              totalQuestions={
                questionPackage.questions.filter((q) => q.isActive !== false).length
              }
              completedCount={currentSession.chestsCompleted.length}
              showInstantFeedback={questionPackage.showInstantFeedback}
              onSaveAnswer={handleSaveAnswer}
              onAllCompleted={() => {
                setActiveQuestion(null);
                void handleFinishQuest();
              }}
              onClose={() => setActiveQuestion(null)}
            />
          )}

          {/* Pause Menu */}
          {view === 'game' && isPaused && (
            <PauseMenu
              onResume={() => setIsPaused(false)}
              onRestart={() => {
                if (currentSession) {
                  setIsPaused(false);
                  clearActiveRecoveryState();
                  handleStartGame(currentSession.student.name, currentSession.student.grade);
                }
              }}
              onExitToMenu={() => {
                setIsPaused(false);
                clearActiveRecoveryState();
                restorePoseRef.current = null;
                latestPoseRef.current = null;
                setCurrentSession(null);
                setView('cover');
              }}
              onOpenInstructions={() => setShowInstructions(true)}
            />
          )}
        </div>
      )}

      {/* 1.5 FULLSCREEN PIRATE LOADING SCREEN OVERLAY */}
      {view === 'loading' && pendingStudent && (
        <LoadingScreen
          studentName={pendingStudent.name}
          studentGrade={pendingStudent.grade}
          progressPercent={loadingProgress}
          statusMessage={loadingStatus}
          error={loadingError || undefined}
          onRetry={handleRetryLoading}
          onBackToLogin={() => {
            setIsStartingSession(false);
            setLoadingError('');
            clearActiveRecoveryState();
            restoringSessionRef.current = null;
            restorePoseRef.current = null;
            setView('login');
          }}
        />
      )}

      {/* 3. RESULT & CERTIFICATE VIEW */}
      {view === 'result' && currentSession && questionPackage && (
        <ResultScreen
          session={currentSession}
          questionPackage={questionPackage}
          onSessionUpdated={(updated) => {
            setCurrentSession(updated);
            saveStudentSession(updated);
            clearActiveRecoveryState();
          }}
          onPlayAgain={() => {
            clearActiveRecoveryState();
            handleStartGame(currentSession.student.name, currentSession.student.grade);
          }}
          onExitToMenu={() => {
            clearActiveRecoveryState();
            setView('cover');
          }}
        />
      )}

      {/* 4. TEACHER DASHBOARD VIEW */}
      {view === 'teacher' && (
        <TeacherDashboard
          onBackToGame={() => {
            void loadActivePackageFromServer();
            setView('cover');
          }}
        />
      )}

      {/* Global Instructions Modal */}
      {showInstructions && (
        <InstructionScreen onClose={() => setShowInstructions(false)} />
      )}
    </div>
  );
}
