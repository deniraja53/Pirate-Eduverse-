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
  type StudentAnswer,
  type StudentSession,
} from './types/game';
import { DEFAULT_GAME_CONFIG, type GameConfig } from './game/GameConfig';
import type { RaycastDebugData } from './game/MapEnvironment';
import { createInitialMiniMapState, type MiniMapLiveState } from './game/MiniMapTypes';
import { saveStudentSession } from './services/storage';
import { sounds } from './services/audio';
import {
  completeStudentSessionApi,
  connectRealtimeWs,
  fetchActiveQuiz,
  startStudentSessionApi,
  submitStudentAnswerApi,
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

  // Active Student Game Session
  const [currentSession, setCurrentSession] = useState<StudentSession | null>(null);

  // Active Chest Question being answered + duration tracking
  const [activeQuestion, setActiveQuestion] = useState<Question | null>(null);
  const chestOpenedAtRef = useRef<number>(Date.now());
  const miniMapStateRef = useRef<MiniMapLiveState>(createInitialMiniMapState());

  // Virtual Controls for Touch Screens
  const [joystickVector, setJoystickVector] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [interactTrigger, setInteractTrigger] = useState<number>(0);
  const [jumpTrigger, setJumpTrigger] = useState<number>(0);

  const loadActivePackageFromServer = useCallback(async () => {
    try {
      const res = await fetchActiveQuiz();
      if (res.success && res.activePackage) {
        setQuestionPackage(res.activePackage);
        setQuizLoadError('');
      } else {
        setQuestionPackage(null);
        setQuizLoadError(
          res.message ||
            'Belum ada paket soal aktif yang diterbitkan oleh guru. Silakan buka Portal Guru untuk menerbitkan kuis.'
        );
      }
    } catch {
      setQuizLoadError('Gagal memuat paket soal aktif dari server.');
    }
  }, []);

  // Load active quiz initially & whenever entering cover/login
  useEffect(() => {
    if (view === 'cover' || view === 'login') {
      void loadActivePackageFromServer();
    }
  }, [view, loadActivePackageFromServer]);

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
        setQuestionPackage(evt.payload);
        setQuizLoadError('');
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
    miniMapStateRef.current.ready = false;
    setPendingStudent({ name: trimmedName, grade: validGrade });
    setCurrentSession(null);
    setActiveQuestion(null);
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

  // Real Loading Orchestration: Session API + Panel Image Preload -> Mount 3D Scene
  useEffect(() => {
    if (view !== 'loading' || !pendingStudent) return;

    let cancelled = false;
    setIsStartingSession(true);
    setLoadingError('');
    setLoadingProgress(18);
    setLoadingStatus('Menyiapkan sesi siswa & bank soal...');

    const timeoutId = window.setTimeout(() => {
      if (!cancelled) {
        setIsStartingSession(false);
        setLoadingError('Waktu pemuatan melebihi batas. Periksa koneksi Anda lalu coba lagi.');
      }
    }, 35000);

    const preloadImage = (src: string) =>
      new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(`Gagal memuat aset gambar: ${src}`));
        img.src = src;
      });

    (async () => {
      try {
        const [sessionRes] = await Promise.all([
          startStudentSessionApi(pendingStudent.name, pendingStudent.grade),
          preloadImage(QUESTION_PANEL_ASSET),
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

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [view, loadingAttempt, pendingStudent]);

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
      setView('game');
    }, waitMs);

    return () => window.clearTimeout(timer);
  }, [view, assetsPreloaded, sceneReady, loadingError]);

  const handleRetryLoading = () => {
    if (!pendingStudent) {
      setView('login');
      return;
    }
    setCurrentSession(null);
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
    try {
      const res = await completeStudentSessionApi(currentSession.sessionId);
      if (res.success && res.session) {
        setCurrentSession(res.session);
        saveStudentSession(res.session);
      }
    } catch {
      const fallbackCompleted: StudentSession = {
        ...currentSession,
        isCompleted: true,
        endTime: new Date().toISOString(),
      };
      setCurrentSession(fallbackCompleted);
      saveStudentSession(fallbackCompleted);
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
      {/* 0. COVER SCREEN VIEW */}
      {view === 'cover' && (
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
            isPaused={view === 'loading' || isPaused || !!activeQuestion}
            gameConfig={gameConfig}
            onUpdateDebugData={setDebugData}
            onUpdateChestPlacements={setChestPlacements}
            miniMapStateRef={miniMapStateRef}
            virtualJoystickVector={joystickVector}
            virtualInteractTrigger={interactTrigger}
            virtualJumpTrigger={jumpTrigger}
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
              onPause={() => setIsPaused(true)}
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
              totalQuestions={questionPackage.questions.length}
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
                  handleStartGame(currentSession.student.name, currentSession.student.grade);
                }
              }}
              onExitToMenu={() => {
                setIsPaused(false);
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
          }}
          onPlayAgain={() => {
            handleStartGame(currentSession.student.name, currentSession.student.grade);
          }}
          onExitToMenu={() => setView('cover')}
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
