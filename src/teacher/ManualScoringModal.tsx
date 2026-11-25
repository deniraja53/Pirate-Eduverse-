/**
 * Manual Scoring Modal for Teachers (Pixel Art Retro V11)
 * Persists manual grading score, feedback, grader name, and timestamp to server,
 * triggering live WebSocket updates and Google Sheets re-sync.
 * Created by Deni Raja99
 */

import React, { useState } from 'react';
import { CheckCircle2, X, AlertTriangle } from 'lucide-react';
import { getQuestionTypeLabel, type Question, type StudentSession } from '../types/game';
import { gradeStudentAnswerApi } from '../services/apiClient';
import { sounds } from '../services/audio';

interface ManualScoringModalProps {
  session: StudentSession;
  question: Question;
  onClose: () => void;
  onScoreUpdated: (updatedSession: StudentSession) => void;
}

export const ManualScoringModal: React.FC<ManualScoringModalProps> = ({
  session,
  question,
  onClose,
  onScoreUpdated,
}) => {
  const currentAnswer = session.answers[question.id];
  const [score, setScore] = useState<number>(currentAnswer?.scoreAwarded ?? 0);
  const [feedback, setFeedback] = useState<string>(currentAnswer?.teacherFeedback || '');
  const [gradedBy, setGradedBy] = useState<string>(currentAnswer?.gradedBy || 'Guru Pengawas');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving || !currentAnswer) return;

    setIsSaving(true);
    setErrorMsg('');
    const clampedScore = Math.min(question.points, Math.max(0, Number(score)));

    try {
      const res = await gradeStudentAnswerApi(session.sessionId, {
        questionId: question.id,
        scoreAwarded: clampedScore,
        teacherFeedback: feedback,
        gradedBy: gradedBy.trim() || 'Guru Pengawas',
      });

      if (res.success && res.session) {
        sounds.playCorrect();
        setMessage('Nilai & catatan guru tersimpan ke server dan disinkronkan!');
        onScoreUpdated(res.session);
        setTimeout(() => {
          onClose();
        }, 550);
      } else {
        sounds.playWrong();
        setErrorMsg(res.message || 'Gagal menyimpan nilai ke server.');
      }
    } catch (err) {
      sounds.playWrong();
      setErrorMsg(err instanceof Error ? err.message : 'Kesalahan jaringan saat menyimpan nilai.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
      <div className="px-card-gold relative w-full max-w-lg p-5 sm:p-6 text-[#f8f4ff]">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b-2 border-[#6d28d9]">
          <div>
            <h3 className="text-sm sm:text-base font-bold text-[#facc15]">
              KOREKSI JAWABAN: {session.student.name} ({session.student.grade})
            </h3>
            <p className="text-xs text-[#cbb7eb] mt-0.5">
              Peti #{question.number} • {getQuestionTypeLabel(question.type)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-btn px-btn-pink p-1.5 cursor-pointer"
            aria-label="Tutup modal koreksi"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="my-4 space-y-3.5 text-xs">
          <div className="px-subcard p-3.5">
            <span className="text-[10px] uppercase font-bold text-[#facc15] block mb-1">
              Pertanyaan Peti:
            </span>
            <p className="text-[#f8f4ff] text-sm font-medium">{question.prompt}</p>
            {question.essayRubric && (
              <div className="mt-2 text-[11px] text-[#facc15] bg-[#281647] p-2 border border-[#6d28d9]">
                <strong>Rubrik Guru:</strong> {question.essayRubric}
              </div>
            )}
          </div>

          <div className="px-subcard p-3.5 border-[#ec4899]">
            <span className="text-[10px] uppercase font-bold text-[#f472b6] block mb-1">
              Jawaban Siswa:
            </span>
            <div className="text-[#f8f4ff] text-sm font-medium whitespace-pre-wrap bg-[#0d051a] p-2.5 border border-[#4c1d95]">
              {(() => {
                const raw = currentAnswer?.answerText;
                if (!raw) return '(Siswa belum mengirimkan jawaban untuk peti ini)';
                if (raw.startsWith('{') || raw.startsWith('[')) {
                  try {
                    const parsed = JSON.parse(raw);
                    if (Array.isArray(parsed)) return parsed.join(', ');
                    if (parsed && typeof parsed === 'object') {
                      return Object.entries(parsed as Record<string, unknown>)
                        .map(([k, v]) => `${k} -> ${String(v)}`)
                        .join('\n');
                    }
                  } catch {
                    // fall through
                  }
                }
                return raw;
              })()}
            </div>
            <div className="mt-1.5 flex flex-wrap justify-between text-[10px] text-[#cbb7eb]">
              <span>
                Dikirim:{' '}
                {currentAnswer?.answeredAt
                  ? new Date(currentAnswer.answeredAt).toLocaleString('id-ID')
                  : '-'}
              </span>
              {currentAnswer?.gradedAt && (
                <span>
                  Terakhir dinilai oleh <strong>{currentAnswer.gradedBy || 'Guru'}</strong> pada{' '}
                  {new Date(currentAnswer.gradedAt).toLocaleString('id-ID')}
                </span>
              )}
            </div>
          </div>

          <form onSubmit={handleSave} className="space-y-3 pt-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="px-subcard flex items-center justify-between gap-2 p-3">
                <label className="font-bold text-[#facc15] text-xs">
                  Nilai (Maks {question.points}):
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    max={question.points}
                    value={score}
                    onChange={(e) => setScore(Number(e.target.value))}
                    className="px-input w-16 px-2 py-1.5 text-[#facc15] font-bold text-center text-sm"
                    required
                  />
                  <span className="text-[#cbb7eb]">/ {question.points}</span>
                </div>
              </div>

              <div className="px-subcard p-2.5">
                <label className="block text-[10px] font-bold text-[#cbb7eb] mb-0.5">
                  Nama Penilai (Guru):
                </label>
                <input
                  type="text"
                  value={gradedBy}
                  onChange={(e) => setGradedBy(e.target.value)}
                  className="px-input w-full px-2.5 py-1 text-xs"
                />
              </div>
            </div>

            <div>
              <label className="block font-bold text-[#cbb7eb] text-xs mb-1">
                Catatan / Masukan Guru untuk Siswa (Opsional):
              </label>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={2}
                placeholder="Contoh: Penjelasanmu sudah sangat baik dan lengkap!"
                className="px-input w-full px-3 py-2 text-xs"
              />
            </div>

            {errorMsg && (
              <div className="p-2.5 bg-red-950/90 border-2 border-[#ef4444] text-red-200 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[#ef4444] shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {message && (
              <div className="p-2 bg-emerald-950/90 border-2 border-[#22c55e] text-emerald-200 text-center text-xs font-bold">
                {message}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-btn px-btn-dark px-4 py-2 text-xs cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={isSaving || !currentAnswer}
                className="px-btn px-btn-gold px-5 py-2 text-xs cursor-pointer flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{isSaving ? 'Menyimpan...' : 'Simpan Nilai'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
