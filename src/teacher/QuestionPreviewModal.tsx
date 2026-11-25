/**
 * Question Preview Modal & Pixel Art Confirmation Dialog
 * Shows an accurate in-game parchment preview of how a question appears to students
 * (including image placement, options, points, and educational explanation).
 * Created by Deni Raja99
 */

import React, { useState } from 'react';
import { Award, BookOpen, CheckSquare, Eye, ImageOff, Square, X, AlertTriangle } from 'lucide-react';
import { getQuestionTypeLabel, type Question } from '../types/game';
import { getShortAnswerAcceptedList, normalizeTrueFalseValue } from './questionValidation';
import { QUESTION_PANEL_ASSET } from '../components/QuestionPanel';

interface QuestionPreviewModalProps {
  question: Question;
  onClose: () => void;
}

export const QuestionPreviewModal: React.FC<QuestionPreviewModalProps> = ({
  question,
  onClose,
}) => {
  const [imgError, setImgError] = useState(false);
  const formattedNumber = String(question.number || 1).padStart(2, '0');

  const typeLabel = getQuestionTypeLabel(question.type);

  const renderImage = () => {
    if (!question.imageUrl) return null;
    if (imgError) {
      return (
        <div className="px-3 py-2 rounded-lg border border-red-700/40 bg-red-100 text-red-900 text-xs font-bold flex items-center gap-2">
          <ImageOff className="w-4 h-4 shrink-0" />
          <span>Gambar gagal dimuat: {question.imageUrl}</span>
        </div>
      );
    }
    return (
      <figure className="rounded-lg border-2 border-[#a16207]/50 bg-[#fffaf0]/90 p-1.5 inline-block max-w-full">
        <img
          src={question.imageUrl}
          alt={question.imageAlt || 'Gambar soal'}
          onError={() => setImgError(true)}
          className="max-h-36 w-auto max-w-full object-contain rounded mx-auto"
        />
        {question.imageAlt && (
          <figcaption className="text-[10px] text-[#6b3b14] font-semibold text-center mt-1">
            {question.imageAlt}
          </figcaption>
        )}
      </figure>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
      <div className="px-card-gold w-full max-w-3xl p-4 sm:p-5 space-y-4 max-h-[94vh] overflow-y-auto">
        <div className="flex items-center justify-between gap-3 border-b-2 border-[#6d28d9] pb-3">
          <div className="flex items-center gap-2">
            <Eye className="w-5 h-5 text-[#facc15]" />
            <h3 className="text-sm sm:text-base font-bold text-[#facc15]">
              PRATINJAU TAMPILAN GAME 3D • SOAL #{question.number}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-btn px-btn-pink p-1.5 cursor-pointer"
            aria-label="Tutup pratinjau"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Parchment preview mimicking actual QuestionPanel geometry */}
        <div
          className="relative mx-auto w-full overflow-hidden rounded border-2 border-[#4c1d95]"
          style={{ aspectRatio: '1250 / 884', containerType: 'inline-size' }}
        >
          <img
            src={QUESTION_PANEL_ASSET}
            alt="Latar Perkamen Game"
            className="absolute inset-0 w-full h-full object-fill pointer-events-none select-none"
          />

          <div className="absolute left-[9.44%] top-[3.39%] w-[19.92%] h-[10.75%] flex items-center justify-center z-10 px-2">
            <span
              className="font-cinzel font-black text-[#3b1d06] tracking-wider uppercase whitespace-nowrap"
              style={{ fontSize: 'clamp(10px, 2.3cqw, 22px)' }}
            >
              SOAL {formattedNumber}
            </span>
          </div>

          <div className="absolute left-[6.2%] right-[6.2%] top-[22.8%] bottom-[18.2%] flex flex-col justify-between overflow-hidden z-10">
            <div className="shrink-0 flex items-center justify-between gap-2 pb-1.5 border-b border-[#784316]/25 text-[#5c3312] font-bold text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="uppercase font-extrabold text-[#451a03]">{typeLabel}</span>
                <span>·</span>
                <span className="inline-flex items-center gap-1 text-[#78350f]">
                  <Award className="w-3.5 h-3.5" />
                  {question.points} Poin
                </span>
                {question.isActive === false && (
                  <span className="px-2 py-0.5 bg-red-700 text-white rounded text-[10px]">
                    NONAKTIF (TIDAK MUNCUL DI GAME)
                  </span>
                )}
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto pr-[11%] py-2 space-y-2.5 text-[#231004]">
              {question.instructions && (
                <p className="text-xs italic font-semibold text-[#78350f]">
                  Petunjuk: {question.instructions}
                </p>
              )}

              {question.imagePosition === 'before' && renderImage()}

              <p className="font-extrabold text-sm sm:text-base leading-snug whitespace-pre-wrap">
                {question.prompt || '(Teks pertanyaan belum diisi)'}
              </p>

              {question.imagePosition !== 'before' && renderImage()}

              {(question.type === 'multiple_choice' || question.type === 'multiple_choice_complex') && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {(question.options || []).map((opt) => {
                    const optIdUpper = opt.id.trim().toUpperCase();
                    const isKey =
                      question.type === 'multiple_choice'
                        ? Boolean(question.correctAnswer) &&
                          optIdUpper === question.correctAnswer!.trim().toUpperCase()
                        : Array.isArray(question.correctAnswers) &&
                          question.correctAnswers.map((k) => k.trim().toUpperCase()).includes(optIdUpper);
                    return (
                      <div
                        key={opt.id}
                        className={`px-3 py-2 rounded-xl border-2 flex items-start gap-2 text-xs font-bold ${
                          isKey
                            ? 'bg-emerald-100 border-emerald-700 text-emerald-950'
                            : 'bg-[#fff8eb]/85 border-[#a16207]/45 text-[#231004]'
                        }`}
                      >
                        {question.type === 'multiple_choice_complex' ? (
                          isKey ? (
                            <CheckSquare className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                          ) : (
                            <Square className="w-4 h-4 text-[#78350f] shrink-0 mt-0.5" />
                          )
                        ) : (
                          <span
                            className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[11px] font-black ${
                              isKey ? 'bg-emerald-700 text-white' : 'bg-[#d97706]/30 text-[#451a03]'
                            }`}
                          >
                            {opt.id}
                          </span>
                        )}
                        <span className="break-words min-w-0 flex-1">
                          {question.type === 'multiple_choice_complex' ? `${opt.id}. ` : ''}
                          {opt.text || `(Opsi ${opt.id} kosong)`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {question.type === 'true_false' && (() => {
                const tf =
                  typeof question.correctBoolean === 'boolean'
                    ? question.correctBoolean
                    : normalizeTrueFalseValue(question.correctAnswer);
                return (
                  <div className="grid grid-cols-2 gap-2.5 pt-1">
                    {([
                      { label: 'BENAR', val: true },
                      { label: 'SALAH', val: false },
                    ] as const).map((item) => {
                      const isKey = tf === item.val;
                      return (
                        <div
                          key={item.label}
                          className={`px-4 py-2.5 rounded-xl border-2 text-center font-black text-xs ${
                            isKey
                              ? 'bg-emerald-100 border-emerald-700 text-emerald-950'
                              : 'bg-[#fff8eb]/85 border-[#a16207]/45 text-[#231004]'
                          }`}
                        >
                          {item.label} {isKey ? '✓ (Kunci)' : ''}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {question.type === 'matching' && (
                <div className="space-y-1.5 pt-1">
                  {(question.matchingPairs || []).map((pair, idx) => (
                    <div
                      key={pair.id || idx}
                      className="px-3 py-2 rounded-xl border-2 border-[#a16207]/45 bg-[#fff8eb]/85 text-xs font-bold flex items-center justify-between gap-2 text-[#231004]"
                    >
                      <span className="flex-1">{idx + 1}. {pair.left || '(Kiri kosong)'}</span>
                      <span className="text-[#78350f] font-black">&harr;</span>
                      <span className="flex-1 text-right text-emerald-900">
                        {pair.right || '(Kanan kosong)'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {question.type === 'short_answer' && (() => {
                const accepted = getShortAnswerAcceptedList(question);
                return (
                  <div className="px-3 py-2 rounded-xl border-2 border-[#a16207]/50 bg-[#fffaf0]/90 text-xs text-[#78350f]">
                    Kolom jawaban singkat siswa • Jawaban diterima:{' '}
                    <strong>
                      {accepted.length > 0 ? accepted.join(' / ') : 'Belum ditentukan'}
                    </strong>
                  </div>
                );
              })()}

              {question.type === 'essay' && (
                <div className="px-3 py-2 rounded-xl border-2 border-[#a16207]/50 bg-[#fffaf0]/90 text-xs text-[#78350f]">
                  Area jawaban esai siswa • Rubrik:{' '}
                  <strong>{question.essayRubric || 'Koreksi Manual Guru'}</strong>
                </div>
              )}

              {question.explanation && (
                <div className="p-2.5 rounded-xl border border-emerald-700/40 bg-emerald-50/90 text-emerald-950 text-xs flex items-start gap-2">
                  <BookOpen className="w-4 h-4 shrink-0 mt-0.5 text-emerald-700" />
                  <div>
                    <strong>Pembahasan:</strong> {question.explanation}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-btn px-btn-gold px-5 py-2 text-xs cursor-pointer"
          >
            Tutup Pratinjau
          </button>
        </div>
      </div>
    </div>
  );
};

interface PixelConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const PixelConfirmModal: React.FC<PixelConfirmModalProps> = ({
  title,
  message,
  confirmLabel = 'Ya, Lanjutkan',
  cancelLabel = 'Batal',
  danger = true,
  onConfirm,
  onCancel,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
      <div className="px-card-pink w-full max-w-md p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-[#ec4899]/20 border-2 border-[#ec4899] flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-[#facc15]" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-[#facc15]">{title}</h3>
            <p className="text-xs text-[#f8f4ff] leading-relaxed">{message}</p>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-btn px-btn-dark px-4 py-2 text-xs cursor-pointer"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-btn ${danger ? 'px-btn-red' : 'px-btn-gold'} px-4 py-2 text-xs cursor-pointer`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
