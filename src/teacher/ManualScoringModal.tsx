/**
 * Manual Scoring Modal for Teachers (V4 Backend-Authoritative)
 * Persists manual grading score, feedback, grader name, and timestamp to server,
 * triggering live WebSocket updates and Google Sheets re-sync.
 * Created by Deni Raja99
 */

import React, { useState } from 'react';
import { CheckCircle2, X, AlertTriangle } from 'lucide-react';
import type { Question, StudentSession } from '../types/game';
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs select-none">
      <div className="relative w-full max-w-lg bg-gradient-to-b from-slate-900 to-slate-950 border-2 border-amber-500/80 rounded-3xl p-6 text-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div>
            <h3 className="text-lg font-bold font-pirate text-amber-300">
              Koreksi Jawaban: {session.student.name} ({session.student.grade})
            </h3>
            <p className="text-xs text-slate-400">
              Peti #{question.number} •{' '}
              {question.type === 'essay'
                ? 'Soal Esai'
                : question.type === 'short_answer'
                ? 'Isian Singkat'
                : 'Pilihan Ganda'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="my-4 space-y-4 text-xs">
          {/* Question Prompt */}
          <div className="bg-slate-900/90 border border-slate-800 p-3.5 rounded-xl">
            <span className="text-[10px] uppercase font-bold text-amber-400 block mb-1">
              Pertanyaan Peti:
            </span>
            <p className="text-slate-200 text-sm font-medium">{question.prompt}</p>
            {question.essayRubric && (
              <div className="mt-2 text-[11px] text-amber-300/80 bg-amber-950/40 p-2 rounded-lg border border-amber-700/30">
                <strong>Rubrik Guru:</strong> {question.essayRubric}
              </div>
            )}
          </div>

          {/* Student's Answer */}
          <div className="bg-amber-950/20 border border-amber-600/40 p-3.5 rounded-xl">
            <span className="text-[10px] uppercase font-bold text-amber-300 block mb-1">
              Jawaban Siswa:
            </span>
            <div className="text-slate-100 text-sm font-medium whitespace-pre-wrap bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
              {currentAnswer?.answerText || '(Siswa belum mengirimkan jawaban untuk peti ini)'}
            </div>
            <div className="mt-1.5 flex flex-wrap justify-between text-[10px] text-slate-400">
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

          {/* Grading Form */}
          <form onSubmit={handleSave} className="space-y-3 pt-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex items-center justify-between gap-2 bg-slate-900 p-3 rounded-xl border border-slate-800">
                <label className="font-bold text-amber-300 text-xs">
                  Nilai (Maks {question.points}):
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    max={question.points}
                    value={score}
                    onChange={(e) => setScore(Number(e.target.value))}
                    className="w-16 px-2 py-1.5 bg-slate-950 border border-amber-500 rounded-lg text-amber-300 font-bold text-center text-sm focus:outline-none"
                    required
                  />
                  <span className="text-slate-400">/ {question.points}</span>
                </div>
              </div>

              <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-800">
                <label className="block text-[10px] font-bold text-slate-400 mb-0.5">
                  Nama Penilai (Guru):
                </label>
                <input
                  type="text"
                  value={gradedBy}
                  onChange={(e) => setGradedBy(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 px-2.5 py-1 rounded-lg text-xs text-white focus:outline-none focus:border-amber-400"
                />
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-300 text-xs mb-1">
                Catatan / Masukan Guru untuk Siswa (Opsional):
              </label>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={2}
                placeholder="Contoh: Penjelasanmu sudah sangat baik dan lengkap!"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
              />
            </div>

            {errorMsg && (
              <div className="p-2.5 bg-red-950/80 border border-red-500 text-red-200 rounded-lg text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {message && (
              <div className="p-2 bg-emerald-950 border border-emerald-600 text-emerald-300 rounded-lg text-center text-xs font-bold">
                {message}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-bold rounded-xl cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={isSaving || !currentAnswer}
                className="px-5 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-amber-950 font-bold text-xs rounded-xl shadow-md cursor-pointer flex items-center gap-1.5"
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
