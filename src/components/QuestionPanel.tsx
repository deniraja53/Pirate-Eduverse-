/**
 * QuestionPanel Component for Pirate Academy: Treasure Quest (V7 Interactive Feedback)
 * Uses the authentic uploaded parchment panel (/assets/aistudio/Desain_tanpa_judul__6__dff919a6.png, 1250x884)
 * with exact pixel-calibrated safe areas:
 *   - AREA A (Top-Left Plaque): left 9.44%, top 3.39%, width 19.92%, height 10.75% -> displays "SOAL XX"
 *   - AREA B (Main Parchment): left 6.2%, right 6.2%, top 22.8%, bottom 18.2% -> prompt + answers + feedback + actions
 *   - AREA C (Bottom-Right Avatar): protected via pr-[10%]..pr-[12.5%] safe margin so avatar is never covered
 * Features:
 *   - Green feedback ("JAWABAN BENAR!" + checkmark) and Red feedback ("JAWABAN BELUM TEPAT" + X icon)
 *   - Verified correct answer & educational explanation directly below status
 *   - Essay / unkeyed questions stay "MENUNGGU PENILAIAN" (never marked wrong prematurely)
 *   - Authoritative server confirmation & answer lock (zero double-scoring)
 * Created by Deni Raja99
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import confetti from 'canvas-confetti';
import {
  getQuestionTypeLabel,
  Question,
  StudentAnswer,
  StudentSession,
} from '../types/game';
import {
  getShortAnswerAcceptedList,
  normalizeTrueFalseValue,
} from '../teacher/questionValidation';
import { sounds } from '../services/audio';
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Award,
  X,
  Send,
  Clock,
  ArrowRight,
  BookOpen,
  CheckSquare,
  Square,
} from 'lucide-react';

export const QUESTION_PANEL_ASSET = '/assets/aistudio/Desain_tanpa_judul__6__dff919a6.png';

interface SaveAnswerResult {
  success: boolean;
  message?: string;
  answer?: StudentAnswer;
  session?: StudentSession;
}

interface QuestionPanelProps {
  question: Question;
  existingAnswer?: StudentAnswer;
  totalQuestions?: number;
  completedCount?: number;
  showInstantFeedback?: boolean;
  onSaveAnswer: (answer: {
    questionId: string;
    answerText: string;
    isCorrect?: boolean;
    scoreAwarded: number;
  }) => Promise<SaveAnswerResult>;
  onAllCompleted?: () => void;
  onClose: () => void;
}

type PanelPhase = 'question' | 'submitting' | 'feedback';

/**
 * Custom hook for smooth, frame-accurate typewriter text reveal.
 * - Restarts strictly when questionId or fullText changes while active.
 * - Immediately reveals full text if animation is disabled (already answered / submitting / reduced-motion).
 */
function useTypewriter(fullText: string, questionId: string, isActive: boolean) {
  const [visibleCount, setVisibleCount] = useState<number>(() => {
    if (
      !isActive ||
      (typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    ) {
      return fullText.length;
    }
    return 0;
  });

  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!isActive || prefersReducedMotion || !fullText) {
      setVisibleCount(fullText.length);
      return;
    }

    setVisibleCount(0);

    const charDelayMs =
      fullText.length <= 65
        ? 22
        : fullText.length <= 160
        ? 14
        : fullText.length <= 280
        ? 9
        : 6;

    let rafId = 0;
    const startTime = performance.now();

    const step = (now: number) => {
      const elapsed = now - startTime;
      const targetCount = Math.min(fullText.length, Math.floor(elapsed / charDelayMs) + 1);

      setVisibleCount((prev) => (targetCount > prev ? targetCount : prev));

      if (targetCount < fullText.length) {
        rafId = requestAnimationFrame(step);
      }
    };

    rafId = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [questionId, fullText, isActive]);

  const completeImmediately = () => {
    setVisibleCount(fullText.length);
  };

  return {
    displayedText: fullText.slice(0, visibleCount),
    isTyping: isActive && visibleCount < fullText.length,
    completeImmediately,
  };
}

function resolveVerifiedExplanation(
  question: Question,
  isCorrect: boolean | undefined
): string | null {
  if (isCorrect === true) {
    return question.correctExplanation?.trim() || question.explanation?.trim() || null;
  }
  if (isCorrect === false) {
    return question.incorrectExplanation?.trim() || question.explanation?.trim() || null;
  }
  return question.explanation?.trim() || question.essayRubric?.trim() || null;
}

const QuestionImageBanner: React.FC<{ imageUrl: string; imageAlt?: string }> = ({
  imageUrl,
  imageAlt,
}) => {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [imageUrl]);

  if (imgFailed) {
    return (
      <div className="px-3 py-2 rounded-xl border border-amber-700/40 bg-[#fff3d6]/80 text-[#78350f] text-[11px] font-bold flex items-center gap-2">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span>Gambar soal tidak dapat dimuat ({imageAlt || 'ilustrasi soal'}).</span>
      </div>
    );
  }

  return (
    <figure className="rounded-xl border-2 border-[#a16207]/45 bg-[#fffaf0]/85 p-1.5 inline-block max-w-full shadow-xs">
      <img
        src={imageUrl}
        alt={imageAlt || 'Ilustrasi pertanyaan'}
        onError={() => setImgFailed(true)}
        className="max-h-[17cqw] w-auto max-w-full object-contain rounded-lg mx-auto"
      />
      {imageAlt && (
        <figcaption className="text-[10px] text-[#6b3b14] font-semibold text-center mt-1 px-1">
          {imageAlt}
        </figcaption>
      )}
    </figure>
  );
};

export const QuestionPanel: React.FC<QuestionPanelProps> = ({
  question,
  existingAnswer,
  totalQuestions = 0,
  completedCount = 0,
  onSaveAnswer,
  onAllCompleted,
  onClose,
}) => {
  const [phase, setPhase] = useState<PanelPhase>(() =>
    existingAnswer ? 'feedback' : 'question'
  );
  const [wasInitiallyCompleted] = useState<boolean>(() => Boolean(existingAnswer));
  const [selectedOption, setSelectedOption] = useState<string>(existingAnswer?.answerText || '');
  const [selectedOptionsMulti, setSelectedOptionsMulti] = useState<string[]>(() => {
    if (!existingAnswer?.answerText || question.type !== 'multiple_choice_complex') return [];
    return existingAnswer.answerText
      .split(/[\s,;\/&+]+/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => /^[A-Z]$/.test(s));
  });
  const [matchingSelections, setMatchingSelections] = useState<Record<string, string>>(() => {
    if (!existingAnswer?.answerText || question.type !== 'matching') return {};
    try {
      const parsed = JSON.parse(existingAnswer.answerText);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, string>;
      }
    } catch {
      // ignore
    }
    return {};
  });
  const [textAnswer, setTextAnswer] = useState<string>(existingAnswer?.answerText || '');
  const [submittedAnswer, setSubmittedAnswer] = useState<StudentAnswer | undefined>(
    existingAnswer
  );
  const [errorMessage, setErrorMessage] = useState<string>('');
  const feedbackRef = useRef<HTMLDivElement>(null);

  // Deterministically shuffle right-hand choices for matching questions
  const shuffledMatchingChoices = useMemo(() => {
    const pairs = Array.isArray(question.matchingPairs) ? question.matchingPairs : [];
    const rights = pairs.map((p) => p.right).filter(Boolean);
    if (rights.length <= 1) return rights;
    const copy = [...rights];
    let seed = 0;
    for (let i = 0; i < question.id.length; i++) {
      seed = (seed * 31 + question.id.charCodeAt(i)) >>> 0;
    }
    for (let i = copy.length - 1; i > 0; i--) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const j = seed % (i + 1);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }, [question.id, question.matchingPairs]);

  // Sync local state when active question changes while mounted
  useEffect(() => {
    setPhase(existingAnswer ? 'feedback' : 'question');
    setSelectedOption(existingAnswer?.answerText || '');
    setSelectedOptionsMulti(
      existingAnswer?.answerText && question.type === 'multiple_choice_complex'
        ? existingAnswer.answerText
            .split(/[\s,;\/&+]+/)
            .map((s) => s.trim().toUpperCase())
            .filter((s) => /^[A-Z]$/.test(s))
        : []
    );
    if (existingAnswer?.answerText && question.type === 'matching') {
      try {
        const parsed = JSON.parse(existingAnswer.answerText);
        setMatchingSelections(
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, string>)
            : {}
        );
      } catch {
        setMatchingSelections({});
      }
    } else {
      setMatchingSelections({});
    }
    setTextAnswer(existingAnswer?.answerText || '');
    setSubmittedAnswer(existingAnswer);
    setErrorMessage('');
  }, [question.id, existingAnswer, question.type]);

  // Smoothly scroll feedback + explanation into view once submitted
  useEffect(() => {
    if (phase === 'feedback' && feedbackRef.current) {
      feedbackRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [phase]);

  // Typewriter runs strictly in initial 'question' phase and stops cleanly upon submit
  const { displayedText, isTyping, completeImmediately } = useTypewriter(
    question.prompt,
    question.id,
    phase === 'question'
  );

  // Adaptive prompt typography based on prompt length
  const promptTypographyStyle = useMemo<React.CSSProperties>(() => {
    const len = question.prompt.length;
    if (len <= 65) {
      return {
        fontSize: 'clamp(13px, 2.15cqw, 21px)',
        lineHeight: 1.38,
      };
    }
    if (len <= 160) {
      return {
        fontSize: 'clamp(12px, 1.8cqw, 18px)',
        lineHeight: 1.4,
      };
    }
    if (len <= 280) {
      return {
        fontSize: 'clamp(11px, 1.48cqw, 15px)',
        lineHeight: 1.4,
      };
    }
    return {
      fontSize: 'clamp(10.5px, 1.3cqw, 13.5px)',
      lineHeight: 1.36,
    };
  }, [question.prompt.length]);

  const isLocked = phase === 'submitting' || phase === 'feedback';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLocked) return;
    setErrorMessage('');

    let finalAnswer = '';
    let localIsCorrect: boolean | undefined = undefined;
    let localScore = 0;

    if (question.type === 'multiple_choice') {
      if (!selectedOption) {
        setErrorMessage('Silakan pilih salah satu opsi jawaban (A, B, C, atau D) sebelum mengirim!');
        return;
      }
      finalAnswer = selectedOption;
      if (question.correctAnswer) {
        localIsCorrect =
          selectedOption.trim().toUpperCase() === question.correctAnswer.trim().toUpperCase();
        localScore = localIsCorrect ? question.points : 0;
      }
    } else if (question.type === 'multiple_choice_complex') {
      const sorted = Array.from(new Set(selectedOptionsMulti)).sort();
      if (sorted.length === 0) {
        setErrorMessage('Silakan centang minimal satu pilihan jawaban sebelum mengirim!');
        return;
      }
      finalAnswer = sorted.join(', ');
      const keys = Array.isArray(question.correctAnswers)
        ? Array.from(new Set(question.correctAnswers.map((k) => k.trim().toUpperCase()))).sort()
        : [];
      if (keys.length > 0) {
        localIsCorrect =
          sorted.length === keys.length && keys.every((k, idx) => sorted[idx] === k);
        localScore = localIsCorrect ? question.points : 0;
      }
    } else if (question.type === 'true_false') {
      const chosenBool = normalizeTrueFalseValue(selectedOption);
      if (chosenBool === null) {
        setErrorMessage('Silakan pilih BENAR atau SALAH terlebih dahulu!');
        return;
      }
      finalAnswer = chosenBool ? 'Benar' : 'Salah';
      const keyBool =
        typeof question.correctBoolean === 'boolean'
          ? question.correctBoolean
          : normalizeTrueFalseValue(question.correctAnswer);
      if (keyBool !== null) {
        localIsCorrect = chosenBool === keyBool;
        localScore = localIsCorrect ? question.points : 0;
      }
    } else if (question.type === 'matching') {
      const pairs = Array.isArray(question.matchingPairs) ? question.matchingPairs : [];
      if (pairs.some((p) => !matchingSelections[p.id])) {
        setErrorMessage('Lengkapi seluruh pasangan menjodohkan terlebih dahulu sebelum mengirim!');
        return;
      }
      finalAnswer = JSON.stringify(matchingSelections);
      localIsCorrect = pairs.every(
        (p) =>
          (matchingSelections[p.id] || '').trim().toLowerCase() ===
          p.right.trim().toLowerCase()
      );
      localScore = localIsCorrect ? question.points : 0;
    } else if (question.type === 'short_answer') {
      const trimmed = textAnswer.trim();
      if (!trimmed) {
        setErrorMessage('Tolong tuliskan jawaban singkatmu terlebih dahulu!');
        return;
      }
      finalAnswer = trimmed;
      const accepted = getShortAnswerAcceptedList(question);
      if (accepted.length > 0) {
        const normStudent = trimmed.replace(/\s+/g, ' ').toLowerCase();
        localIsCorrect = accepted.some(
          (ans) => ans.trim().replace(/\s+/g, ' ').toLowerCase() === normStudent
        );
        localScore = localIsCorrect ? question.points : 0;
      }
    } else {
      const trimmed = textAnswer.trim();
      if (!trimmed || trimmed.length < 5) {
        setErrorMessage('Tuliskan jawaban esaimu dengan lebih lengkap (minimal 5 karakter)!');
        return;
      }
      finalAnswer = trimmed;
      localIsCorrect = undefined;
      localScore = 0;
    }

    // Stop typewriter cleanly on submission
    completeImmediately();
    setPhase('submitting');

    const res = await onSaveAnswer({
      questionId: question.id,
      answerText: finalAnswer,
      isCorrect: localIsCorrect,
      scoreAwarded: localScore,
    });

    if (!res.success || !res.answer) {
      setPhase('question');
      setErrorMessage(
        res.message || 'Gagal menyimpan jawaban ke server. Silakan periksa koneksi lalu kirim ulang.'
      );
      sounds.playWrong();
      return;
    }

    const authAnswer = res.answer;
    setSubmittedAnswer(authAnswer);
    setPhase('feedback');

    if (authAnswer.isCorrect === true) {
      sounds.playCorrect();
      try {
        confetti({
          particleCount: 55,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#10b981', '#22c55e', '#f59e0b', '#ffd700'],
        });
      } catch {}
    } else if (authAnswer.isCorrect === undefined) {
      sounds.playCorrect();
    } else {
      sounds.playWrong();
    }
  };

  const getTypeLabel = (type: string) => getQuestionTypeLabel(type);

  const formattedNumber = String(question.number).padStart(2, '0');
  const activeResult = submittedAnswer;
  const resultIsCorrect = activeResult?.isCorrect;
  const isPendingReview =
    Boolean(activeResult) &&
    (activeResult?.gradingStatus === 'pending_review' || resultIsCorrect === undefined) &&
    !activeResult?.isGradedManually;

  // Match verified correct option by canonical option ID (never by array index)
  const correctOptionObj = useMemo(() => {
    if (question.type !== 'multiple_choice' || !question.correctAnswer || !question.options) {
      return null;
    }
    const keyUpper = question.correctAnswer.trim().toUpperCase();
    return question.options.find((o) => o.id.trim().toUpperCase() === keyUpper) || null;
  }, [question]);

  // Match student's chosen option by canonical ID
  const studentChosenOptionObj = useMemo(() => {
    if (question.type !== 'multiple_choice' || !activeResult?.answerText || !question.options) {
      return null;
    }
    const ansUpper = activeResult.answerText.trim().toUpperCase();
    return question.options.find((o) => o.id.trim().toUpperCase() === ansUpper) || null;
  }, [question, activeResult]);

  const verifiedExplanation = useMemo(
    () => (activeResult ? resolveVerifiedExplanation(question, resultIsCorrect) : null),
    [activeResult, question, resultIsCorrect]
  );

  const remainingQuestions =
    totalQuestions > 0 ? Math.max(0, totalQuestions - completedCount) : 1;
  const shouldGoToFinalResult =
    !wasInitiallyCompleted && totalQuestions > 0 && remainingQuestions === 0 && Boolean(onAllCompleted);

  const handleContinueClick = () => {
    sounds.playClick();
    if (shouldGoToFinalResult && onAllCompleted) {
      onAllCompleted();
    } else {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/70 select-none">
      {/*
        Unified Aspect-Ratio Container matching exact 1250:884 PNG geometry.
        container-type: inline-size lets typography scale smoothly with the artwork.
      */}
      <div
        className="relative flex items-center justify-center drop-shadow-2xl"
        style={{
          width: 'min(96vw, 960px, calc(92vh * 1250 / 884))',
          aspectRatio: '1250 / 884',
          containerType: 'inline-size',
        }}
      >
        {/* SATU GAMBAR ASSET UTUH SEBAGAI BACKGROUND */}
        <img
          src={QUESTION_PANEL_ASSET}
          alt="Panel Pertanyaan Pirate Academy"
          className="absolute inset-0 w-full h-full object-fill pointer-events-none select-none"
          draggable={false}
        />

        {/*
          AREA A — PAPAN KECIL DI POJOK KIRI ATAS
          Koordinat kalibrasi piksel (1250x884):
          x: 118..367 (9.44% .. +19.92%), y: 30..125 (3.39% .. +10.75%)
        */}
        <div className="absolute left-[9.44%] top-[3.39%] w-[19.92%] h-[10.75%] flex items-center justify-center pointer-events-none select-none z-10 px-2">
          <span
            className="font-cinzel font-black text-[#3b1d06] tracking-wider uppercase leading-none text-center whitespace-nowrap"
            style={{ fontSize: 'clamp(10px, 2.35cqw, 24px)' }}
          >
            SOAL {formattedNumber}
          </span>
        </div>

        {/*
          AREA B — BIDANG PERKAMEN BESAR (SAFE AREA PRESISI)
          Koordinat kalibrasi piksel (1250x884):
          Kiri: 6.2%, Kanan: 6.2%, Atas: 22.8%, Bawah: 18.2%
        */}
        <div className="absolute left-[6.2%] right-[6.2%] top-[22.8%] bottom-[18.2%] flex flex-col justify-between overflow-hidden z-10">
          {/* Header Meta Ringkas di atas perkamen */}
          <div className="shrink-0 flex items-center justify-between gap-2 pb-[0.9cqw] border-b border-[#784316]/25">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[#5c3312] font-bold min-w-0">
              <span
                className="uppercase tracking-wider font-extrabold text-[#451a03]"
                style={{ fontSize: 'clamp(9.5px, 1.2cqw, 12.5px)' }}
              >
                {getTypeLabel(question.type)}
              </span>
              <span className="opacity-50" aria-hidden="true">·</span>
              <span
                className="font-extrabold text-[#78350f] inline-flex items-center gap-1 tabular-nums"
                style={{ fontSize: 'clamp(9.5px, 1.2cqw, 12.5px)' }}
              >
                <Award className="w-[1.3em] h-[1.3em] text-[#92400e]" />
                {question.points} Poin
              </span>
              {question.locationName && (
                <>
                  <span className="hidden sm:inline opacity-50" aria-hidden="true">·</span>
                  <span
                    className="hidden sm:inline text-[#6b3b14] truncate max-w-[26cqw]"
                    style={{ fontSize: 'clamp(9.5px, 1.15cqw, 12px)' }}
                  >
                    {question.locationName}
                  </span>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                sounds.playClick();
                onClose();
              }}
              className="shrink-0 w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-[#78350f]/15 hover:bg-[#78350f]/30 text-[#3b1d06] flex items-center justify-center transition-colors cursor-pointer"
              title="Tutup & Lanjutkan Petualangan"
              aria-label="Tutup panel pertanyaan"
            >
              <X className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>

          {/* Konten Utama: Pertanyaan Typewriter + Opsi / Input + Feedback Hijau/Merah + Pembahasan */}
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-[1%] py-[1cqw] flex flex-col gap-[1cqw]">
            {/* Alert Validasi / Gagal Kirim */}
            {errorMessage && (
              <div className="shrink-0 pr-[10%]">
                <div
                  className="px-3 py-2 bg-red-100 border-2 border-red-700 text-red-950 rounded-xl text-xs font-bold flex items-center gap-2"
                  role="alert"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-700" />
                  <span>{errorMessage}</span>
                </div>
              </div>
            )}

            {/* Instruksi Khusus Soal (Jika ada dari PDF/Guru) */}
            {question.instructions && (
              <div className="shrink-0 pr-[10%] text-[11px] sm:text-xs font-semibold italic text-[#78350f]">
                Petunjuk: {question.instructions}
              </div>
            )}

            {/* Gambar Soal (Sebelum Pertanyaan) */}
            {question.imageUrl && question.imagePosition === 'before' && (
              <div className="shrink-0 pr-[11%]">
                <QuestionImageBanner imageUrl={question.imageUrl} imageAlt={question.imageAlt} />
              </div>
            )}

            {/* Teks Pertanyaan Langsung di Atas Perkamen (Ghost container = nol layout shift) */}
            <div
              className="relative shrink-0 pr-[10%] cursor-pointer"
              onClick={() => {
                if (isTyping) completeImmediately();
              }}
              title={isTyping ? 'Klik untuk menampilkan seluruh teks pertanyaan' : undefined}
            >
              <p
                aria-hidden="true"
                className="invisible font-extrabold break-words whitespace-pre-wrap select-none"
                style={promptTypographyStyle}
              >
                {question.prompt}
              </p>

              <p
                aria-live="polite"
                className="absolute inset-0 pr-[10%] font-extrabold text-[#231004] break-words whitespace-pre-wrap text-left"
                style={promptTypographyStyle}
              >
                {displayedText}
                {isTyping && (
                  <span
                    aria-hidden="true"
                    className="inline-block w-[0.12em] h-[0.95em] bg-[#451a03] align-middle ml-0.5 animate-pulse"
                  />
                )}
              </p>
            </div>

            {/* Gambar Soal (Sesudah Pertanyaan / Default) */}
            {question.imageUrl && question.imagePosition !== 'before' && (
              <div className="shrink-0 pr-[11%]">
                <QuestionImageBanner imageUrl={question.imageUrl} imageAlt={question.imageAlt} />
              </div>
            )}

            {/* AREA C PROTECTION — Opsi, Jawaban & Feedback diberi pr-[11%] */}
            <div className="pr-[11%] space-y-[1.05cqw] pb-1">
              {/* 1. Pilihan Ganda */}
              {question.type === 'multiple_choice' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-[0.8cqw]">
                  {question.options?.map((opt) => {
                    const isSelected = selectedOption.trim().toUpperCase() === opt.id.trim().toUpperCase();
                    const isVerifiedCorrectOpt =
                      phase === 'feedback' &&
                      Boolean(question.correctAnswer) &&
                      opt.id.trim().toUpperCase() === question.correctAnswer!.trim().toUpperCase();

                    let buttonStyle =
                      'bg-[#fff8eb]/80 hover:bg-[#fff3d6]/95 text-[#231004] border-[#a16207]/45 shadow-xs';
                    let badgeStyle = 'bg-[#d97706]/25 text-[#451a03] border-[#a16207]/50';

                    if (phase === 'feedback') {
                      if (isSelected && resultIsCorrect === true) {
                        buttonStyle =
                          'bg-emerald-700 text-white border-emerald-900 shadow-md';
                        badgeStyle = 'bg-white text-emerald-800 border-white';
                      } else if (isSelected && resultIsCorrect === false) {
                        buttonStyle =
                          'bg-red-700 text-white border-red-900 shadow-md';
                        badgeStyle = 'bg-white text-red-800 border-white';
                      } else if (isVerifiedCorrectOpt && resultIsCorrect === false) {
                        buttonStyle =
                          'bg-emerald-100 text-emerald-950 border-emerald-700 shadow-xs';
                        badgeStyle = 'bg-emerald-700 text-white border-emerald-800';
                      } else if (isSelected) {
                        buttonStyle =
                          'bg-[#78350f] text-[#fef3c7] border-[#451a03] shadow-md';
                        badgeStyle = 'bg-[#fef3c7] text-[#451a03] border-[#fef3c7]';
                      } else {
                        buttonStyle =
                          'bg-[#fff8eb]/55 text-[#451a03]/75 border-[#a16207]/25 opacity-85';
                      }
                    } else if (isSelected) {
                      buttonStyle =
                        'bg-[#78350f] text-[#fef3c7] border-[#451a03] shadow-md';
                      badgeStyle = 'bg-[#fef3c7] text-[#451a03] border-[#fef3c7]';
                    }

                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={isLocked}
                        onClick={() => {
                          if (isLocked) return;
                          sounds.playClick();
                          setSelectedOption(opt.id);
                          setErrorMessage('');
                        }}
                        className={`text-left px-3 py-2 sm:py-2.5 rounded-xl border-2 transition-all flex items-start gap-2.5 ${
                          isLocked ? 'cursor-default' : 'cursor-pointer'
                        } ${buttonStyle}`}
                      >
                        <span
                          className={`w-6 h-6 shrink-0 rounded-full font-black text-xs flex items-center justify-center border ${badgeStyle}`}
                        >
                          {opt.id}
                        </span>
                        <span
                          className="font-bold pt-0.5 leading-snug break-words min-w-0 flex-1"
                          style={{ fontSize: 'clamp(11px, 1.35cqw, 14.5px)' }}
                        >
                          {opt.text}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* 1b. Pilihan Ganda Kompleks (Multi-Select Checkbox) */}
              {question.type === 'multiple_choice_complex' && (() => {
                const keySet = new Set(
                  (Array.isArray(question.correctAnswers) ? question.correctAnswers : []).map((k) =>
                    k.trim().toUpperCase()
                  )
                );
                return (
                  <div className="space-y-1.5">
                    <div
                      className="font-bold text-[#78350f] uppercase"
                      style={{ fontSize: 'clamp(9.5px, 1.1cqw, 11.5px)' }}
                    >
                      Pilih satu atau lebih jawaban yang benar:
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-[0.8cqw]">
                      {question.options?.map((opt) => {
                        const optUpper = opt.id.trim().toUpperCase();
                        const isSelected = selectedOptionsMulti.includes(optUpper);
                        const isCorrectOpt = keySet.has(optUpper);

                        let buttonStyle =
                          'bg-[#fff8eb]/80 hover:bg-[#fff3d6]/95 text-[#231004] border-[#a16207]/45 shadow-xs';
                        if (phase === 'feedback') {
                          if (isSelected && isCorrectOpt) {
                            buttonStyle = 'bg-emerald-700 text-white border-emerald-900 shadow-md';
                          } else if (isSelected && !isCorrectOpt) {
                            buttonStyle = 'bg-red-700 text-white border-red-900 shadow-md';
                          } else if (!isSelected && isCorrectOpt) {
                            buttonStyle = 'bg-emerald-100 text-emerald-950 border-emerald-700 shadow-xs';
                          } else {
                            buttonStyle = 'bg-[#fff8eb]/55 text-[#451a03]/75 border-[#a16207]/25 opacity-85';
                          }
                        } else if (isSelected) {
                          buttonStyle = 'bg-[#78350f] text-[#fef3c7] border-[#451a03] shadow-md';
                        }

                        return (
                          <button
                            key={opt.id}
                            type="button"
                            disabled={isLocked}
                            onClick={() => {
                              if (isLocked) return;
                              sounds.playClick();
                              setSelectedOptionsMulti((prev) =>
                                prev.includes(optUpper)
                                  ? prev.filter((x) => x !== optUpper)
                                  : [...prev, optUpper]
                              );
                              setErrorMessage('');
                            }}
                            className={`text-left px-3 py-2 sm:py-2.5 rounded-xl border-2 transition-all flex items-start gap-2.5 ${
                              isLocked ? 'cursor-default' : 'cursor-pointer'
                            } ${buttonStyle}`}
                          >
                            {isSelected ? (
                              <CheckSquare className="w-5 h-5 shrink-0 mt-0.5" />
                            ) : (
                              <Square className="w-5 h-5 shrink-0 mt-0.5 opacity-75" />
                            )}
                            <span
                              className="font-bold pt-0.5 leading-snug break-words min-w-0 flex-1"
                              style={{ fontSize: 'clamp(11px, 1.35cqw, 14.5px)' }}
                            >
                              {opt.id}. {opt.text}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* 1c. Benar / Salah */}
              {question.type === 'true_false' && (() => {
                const chosenBool = normalizeTrueFalseValue(selectedOption);
                const keyBool =
                  typeof question.correctBoolean === 'boolean'
                    ? question.correctBoolean
                    : normalizeTrueFalseValue(question.correctAnswer);
                return (
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    {([
                      { label: 'BENAR', val: true },
                      { label: 'SALAH', val: false },
                    ] as const).map((item) => {
                      const isSelected = chosenBool === item.val;
                      const isKey = keyBool === item.val;
                      let btnClass =
                        'bg-[#fff8eb]/85 hover:bg-[#fff3d6] text-[#231004] border-[#a16207]/50';
                      if (phase === 'feedback') {
                        if (isSelected && resultIsCorrect === true) {
                          btnClass = 'bg-emerald-700 text-white border-emerald-900 shadow-md';
                        } else if (isSelected && resultIsCorrect === false) {
                          btnClass = 'bg-red-700 text-white border-red-900 shadow-md';
                        } else if (isKey && resultIsCorrect === false) {
                          btnClass = 'bg-emerald-100 text-emerald-950 border-emerald-700';
                        } else {
                          btnClass = 'bg-[#fff8eb]/55 text-[#451a03]/70 border-[#a16207]/25';
                        }
                      } else if (isSelected) {
                        btnClass = 'bg-[#78350f] text-[#fef3c7] border-[#451a03] shadow-md';
                      }

                      return (
                        <button
                          key={item.label}
                          type="button"
                          disabled={isLocked}
                          onClick={() => {
                            if (isLocked) return;
                            sounds.playClick();
                            setSelectedOption(item.val ? 'Benar' : 'Salah');
                            setErrorMessage('');
                          }}
                          className={`py-3 px-4 rounded-xl border-2 font-black tracking-wide transition-all flex items-center justify-center gap-2 ${
                            isLocked ? 'cursor-default' : 'cursor-pointer'
                          } ${btnClass}`}
                          style={{ fontSize: 'clamp(12px, 1.5cqw, 16px)' }}
                        >
                          {item.val ? (
                            <CheckCircle2 className="w-4 h-4 shrink-0" />
                          ) : (
                            <XCircle className="w-4 h-4 shrink-0" />
                          )}
                          <span>{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}

              {/* 1d. Menjodohkan (Matching Pairs) */}
              {question.type === 'matching' && (
                <div className="space-y-2">
                  <div
                    className="font-bold text-[#78350f] uppercase"
                    style={{ fontSize: 'clamp(9.5px, 1.1cqw, 11.5px)' }}
                  >
                    Pasangkan pernyataan kiri dengan jawaban yang tepat di sebelah kanan:
                  </div>
                  {(question.matchingPairs || []).map((pair, idx) => {
                    const selectedRight = matchingSelections[pair.id] || '';
                    const isPairCorrect =
                      selectedRight.trim().toLowerCase() === pair.right.trim().toLowerCase();
                    return (
                      <div
                        key={pair.id || idx}
                        className={`p-2.5 rounded-xl border-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-bold ${
                          phase === 'feedback'
                            ? isPairCorrect
                              ? 'bg-emerald-100/90 border-emerald-700 text-emerald-950'
                              : 'bg-red-100/90 border-red-700 text-red-950'
                            : 'bg-[#fff8eb]/85 border-[#a16207]/45 text-[#231004]'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <span className="text-[#78350f] mr-1.5">{idx + 1}.</span>
                          <span>{pair.left}</span>
                        </div>
                        <div className="sm:w-1/2 flex items-center gap-2">
                          <select
                            value={selectedRight}
                            disabled={isLocked}
                            onChange={(e) => {
                              if (isLocked) return;
                              sounds.playClick();
                              setMatchingSelections((prev) => ({
                                ...prev,
                                [pair.id]: e.target.value,
                              }));
                              setErrorMessage('');
                            }}
                            className="w-full px-2.5 py-1.5 rounded-lg border-2 border-[#a16207]/55 bg-[#fffaf0] text-[#231004] font-bold text-xs focus:outline-none"
                          >
                            <option value="">-- Pilih Pasangan --</option>
                            {shuffledMatchingChoices.map((choice, cIdx) => (
                              <option key={`${choice}-${cIdx}`} value={choice}>
                                {choice}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 2. Isian Singkat */}
              {question.type === 'short_answer' && (
                <div className="space-y-1.5">
                  <label
                    className="block font-extrabold uppercase text-[#451a03]"
                    style={{ fontSize: 'clamp(10px, 1.15cqw, 12px)' }}
                  >
                    {phase === 'feedback' ? 'Jawabanmu:' : 'Tuliskan Jawaban Singkatmu:'}
                  </label>
                  <input
                    type="text"
                    value={textAnswer}
                    readOnly={isLocked}
                    disabled={isLocked}
                    onChange={(e) => {
                      if (isLocked) return;
                      setTextAnswer(e.target.value);
                      setErrorMessage('');
                    }}
                    placeholder="Ketik jawaban di sini..."
                    className={`w-full px-3.5 py-2.5 border-2 rounded-xl text-[#231004] font-bold placeholder-[#78350f]/50 focus:outline-none shadow-xs ${
                      isLocked
                        ? 'bg-[#fff3d6]/70 border-[#a16207]/45 cursor-default'
                        : 'bg-[#fffaf0]/90 border-[#a16207]/60 focus:border-[#78350f] focus:ring-2 focus:ring-[#d97706]/30'
                    }`}
                    style={{ fontSize: 'clamp(11.5px, 1.35cqw, 14.5px)' }}
                  />
                </div>
              )}

              {/* 3. Uraian / Esai */}
              {question.type === 'essay' && (
                <div className="space-y-1.5">
                  <div
                    className="flex justify-between items-center font-extrabold uppercase text-[#451a03]"
                    style={{ fontSize: 'clamp(10px, 1.15cqw, 12px)' }}
                  >
                    <span>{phase === 'feedback' ? 'Jawaban Esaimu:' : 'Jawaban Uraian / Esai:'}</span>
                    <span className="font-semibold text-[#78350f]/80 normal-case">
                      {textAnswer.length} karakter
                    </span>
                  </div>
                  <textarea
                    value={textAnswer}
                    readOnly={isLocked}
                    disabled={isLocked}
                    onChange={(e) => {
                      if (isLocked) return;
                      setTextAnswer(e.target.value);
                      setErrorMessage('');
                    }}
                    rows={3}
                    placeholder="Tuliskan jawaban lengkapmu dengan jelas..."
                    className={`w-full px-3.5 py-2 border-2 rounded-xl text-[#231004] font-bold placeholder-[#78350f]/50 focus:outline-none resize-y min-h-[68px] shadow-xs ${
                      isLocked
                        ? 'bg-[#fff3d6]/70 border-[#a16207]/45 cursor-default'
                        : 'bg-[#fffaf0]/90 border-[#a16207]/60 focus:border-[#78350f] focus:ring-2 focus:ring-[#d97706]/30'
                    }`}
                    style={{ fontSize: 'clamp(11.5px, 1.35cqw, 14.5px)' }}
                  />
                </div>
              )}

              {/*
                4 & 5. AREA FEEDBACK HIJAU (BENAR) / MERAH (BELUM TEPAT) / MENUNGGU PENILAIAN
                Tepat di bawah pilihan/jawaban, lengkap dengan jawaban benar dan pembahasan langsung.
              */}
              {phase === 'feedback' && activeResult && (
                <div
                  ref={feedbackRef}
                  data-feedback-status={
                    resultIsCorrect === true
                      ? 'correct'
                      : isPendingReview
                      ? 'pending_review'
                      : 'wrong'
                  }
                  className={`rounded-2xl border-2 overflow-hidden shadow-md ${
                    resultIsCorrect === true
                      ? 'border-emerald-700 bg-emerald-50/95 text-emerald-950'
                      : isPendingReview
                      ? 'border-amber-700 bg-amber-50/95 text-[#3b1d06]'
                      : 'border-red-700 bg-red-50/95 text-red-950'
                  }`}
                  role="status"
                  aria-live="polite"
                >
                  {/* Header Status Berwarna Hijau (Benar) / Merah (Salah) / Amber (Menunggu Penilaian) */}
                  <div
                    className={`px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-white ${
                      resultIsCorrect === true
                        ? 'bg-emerald-700'
                        : isPendingReview
                        ? 'bg-amber-700'
                        : 'bg-red-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-black tracking-wide text-xs sm:text-sm">
                      {resultIsCorrect === true ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-100 shrink-0" />
                          <span>JAWABAN BENAR!</span>
                        </>
                      ) : isPendingReview ? (
                        <>
                          <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-amber-100 shrink-0" />
                          <span>MENUNGGU PENILAIAN</span>
                        </>
                      ) : (
                        <>
                          <XCircle className="w-4 h-4 sm:w-5 sm:h-5 text-red-100 shrink-0" />
                          <span>JAWABAN BELUM TEPAT</span>
                        </>
                      )}
                    </div>

                    <span className="text-[11px] sm:text-xs font-extrabold tabular-nums">
                      {isPendingReview
                        ? `Maks ${activeResult.maxPoints} Poin`
                        : resultIsCorrect === true
                        ? `+${activeResult.scoreAwarded} Poin`
                        : activeResult.isGradedManually
                        ? `Nilai Guru: ${activeResult.scoreAwarded}/${activeResult.maxPoints}`
                        : `0 / ${activeResult.maxPoints} Poin`}
                    </span>
                  </div>

                  {/* Isi Jawaban Benar + Pembahasan Tepat di Bawah Status */}
                  <div className="p-3 sm:p-3.5 space-y-2 text-xs leading-relaxed">
                    {/* Jawaban Benar (untuk benar maupun salah jika kunci tersedia) */}
                    {!isPendingReview && question.type === 'multiple_choice' && question.correctAnswer && (
                      <div
                        className={`px-3 py-1.5 rounded-xl border font-extrabold ${
                          resultIsCorrect === true
                            ? 'bg-emerald-100/90 border-emerald-600/40 text-emerald-950'
                            : 'bg-white/90 border-red-600/35 text-emerald-900'
                        }`}
                      >
                        Jawaban yang benar:{' '}
                        <span>
                          {question.correctAnswer.trim().toUpperCase()}
                          {correctOptionObj
                            ? `. ${correctOptionObj.text}`
                            : studentChosenOptionObj && resultIsCorrect === true
                            ? `. ${studentChosenOptionObj.text}`
                            : ''}
                        </span>
                      </div>
                    )}

                    {!isPendingReview && question.type === 'multiple_choice_complex' && Array.isArray(question.correctAnswers) && question.correctAnswers.length > 0 && (
                      <div
                        className={`px-3 py-1.5 rounded-xl border font-extrabold ${
                          resultIsCorrect === true
                            ? 'bg-emerald-100/90 border-emerald-600/40 text-emerald-950'
                            : 'bg-white/90 border-red-600/35 text-emerald-900'
                        }`}
                      >
                        Jawaban benar:{' '}
                        <span>
                          {question.correctAnswers
                            .map((id) => {
                              const opt = question.options?.find(
                                (o) => o.id.trim().toUpperCase() === id.trim().toUpperCase()
                              );
                              return opt ? `${opt.id}. ${opt.text}` : id;
                            })
                            .join(' | ')}
                        </span>
                      </div>
                    )}

                    {!isPendingReview && question.type === 'true_false' && (
                      <div
                        className={`px-3 py-1.5 rounded-xl border font-extrabold ${
                          resultIsCorrect === true
                            ? 'bg-emerald-100/90 border-emerald-600/40 text-emerald-950'
                            : 'bg-white/90 border-red-600/35 text-emerald-900'
                        }`}
                      >
                        Jawaban yang benar:{' '}
                        <span>
                          {(typeof question.correctBoolean === 'boolean'
                            ? question.correctBoolean
                            : normalizeTrueFalseValue(question.correctAnswer))
                            ? 'BENAR'
                            : 'SALAH'}
                        </span>
                      </div>
                    )}

                    {!isPendingReview && question.type === 'matching' && Array.isArray(question.matchingPairs) && question.matchingPairs.length > 0 && (
                      <div
                        className={`px-3 py-1.5 rounded-xl border font-extrabold ${
                          resultIsCorrect === true
                            ? 'bg-emerald-100/90 border-emerald-600/40 text-emerald-950'
                            : 'bg-white/90 border-red-600/35 text-emerald-900'
                        }`}
                      >
                        Pasangan yang benar:{' '}
                        <span>
                          {question.matchingPairs.map((p) => `${p.left} -> ${p.right}`).join(' | ')}
                        </span>
                      </div>
                    )}

                    {!isPendingReview &&
                      question.type === 'short_answer' &&
                      getShortAnswerAcceptedList(question).length > 0 && (
                        <div
                          className={`px-3 py-1.5 rounded-xl border font-extrabold ${
                            resultIsCorrect === true
                              ? 'bg-emerald-100/90 border-emerald-600/40 text-emerald-950'
                              : 'bg-white/90 border-red-600/35 text-emerald-900'
                          }`}
                        >
                          {resultIsCorrect === true ? 'Jawabanmu: ' : 'Jawaban yang benar: '}
                          <span>
                            {resultIsCorrect === true
                              ? activeResult.answerText
                              : getShortAnswerAcceptedList(question).join(' / ')}
                          </span>
                        </div>
                      )}

                    {/* Pembahasan Edukatif */}
                    <div className="flex items-start gap-2">
                      <BookOpen className="w-4 h-4 shrink-0 mt-0.5 opacity-85" />
                      <div className="min-w-0">
                        <span className="font-extrabold">Pembahasan: </span>
                        <span className="font-semibold">
                          {verifiedExplanation
                            ? verifiedExplanation
                            : isPendingReview
                            ? 'Jawabanmu berhasil disimpan dan menunggu pemeriksaan langsung dari guru.'
                            : 'Pembahasan untuk soal ini belum tersedia.'}
                        </span>
                      </div>
                    </div>

                    {activeResult.teacherFeedback && (
                      <div className="text-xs font-semibold border-t border-current/15 pt-1.5">
                        <strong>Catatan Guru:</strong> {activeResult.teacherFeedback}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/*
            6. Tombol Aksi (Kembali & Kirim Jawaban / LANJUT KE SOAL BERIKUTNYA)
            Menggunakan pr-[12.5%] untuk menjaga area avatar kanan bawah tetap bersih.
          */}
          <div className="shrink-0 pt-[0.9cqw] border-t border-[#784316]/25 flex items-center justify-between gap-3 pr-[12.5%]">
            {phase === 'feedback' ? (
              <>
                <div
                  className="text-[#5c3312] font-bold truncate"
                  style={{ fontSize: 'clamp(10px, 1.15cqw, 12.5px)' }}
                >
                  {shouldGoToFinalResult
                    ? 'Semua peti soal selesai! Siap melihat hasil akhir.'
                    : totalQuestions > 0 && remainingQuestions === 0
                    ? 'Semua peti selesai! Lanjut ke kapal finish.'
                    : totalQuestions > 0
                    ? `Sisa ${remainingQuestions} peti soal lagi di pulau`
                    : 'Jawaban tersimpan di server'}
                </div>

                <button
                  type="button"
                  onClick={handleContinueClick}
                  className="px-4 sm:px-5 py-1.5 sm:py-2 rounded-xl bg-gradient-to-r from-[#047857] to-[#065f46] hover:from-[#059669] hover:to-[#047857] text-white font-extrabold shadow-md flex items-center gap-2 border border-emerald-300/60 cursor-pointer transition-transform active:scale-95 whitespace-nowrap shrink-0 uppercase tracking-wide"
                  style={{ fontSize: 'clamp(10.5px, 1.25cqw, 13.5px)' }}
                >
                  <span>
                    {shouldGoToFinalResult
                      ? 'LIHAT HASIL AKHIR'
                      : 'LANJUT KE SOAL BERIKUTNYA'}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={phase === 'submitting'}
                  onClick={() => {
                    sounds.playClick();
                    onClose();
                  }}
                  className="px-4 py-1.5 sm:py-2 rounded-xl border border-[#78350f]/45 bg-[#fff3d6]/85 hover:bg-[#fde6b8] disabled:opacity-50 text-[#3b1d06] font-extrabold transition-colors cursor-pointer shadow-xs"
                  style={{ fontSize: 'clamp(11px, 1.3cqw, 14px)' }}
                >
                  Kembali
                </button>

                <button
                  type="button"
                  disabled={phase === 'submitting'}
                  onClick={handleSubmit}
                  className="px-5 py-1.5 sm:py-2 rounded-xl bg-gradient-to-r from-[#b45309] to-[#78350f] hover:from-[#92400e] hover:to-[#451a03] disabled:opacity-60 disabled:cursor-wait text-[#fef3c7] font-extrabold shadow-md flex items-center gap-1.5 border border-[#f59e0b]/60 cursor-pointer transition-transform active:scale-95 whitespace-nowrap"
                  style={{ fontSize: 'clamp(11px, 1.3cqw, 14px)' }}
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{phase === 'submitting' ? 'Menyimpan...' : 'Kirim Jawaban'}</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
