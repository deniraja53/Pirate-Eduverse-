/**
 * Interactive Question Editor, Manual Image Uploader & In-Game Preview Workspace (V11 Pixel Art)
 * Supports:
 * - Full CRUD (add, edit, duplicate, reorder up/down, toggle active/inactive, delete w/ custom confirm)
 * - Manual image upload per question (PNG/JPG/WEBP <= 2MB), replace, delete, alt text, before/after position
 * - Live field validation & package-level validation summary
 * - Revert unsaved changes & Save Draft without publishing
 * - In-Game parchment preview modal
 * Created by Deni Raja99
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  CheckSquare,
  Copy,
  Eye,
  EyeOff,
  Flag,
  ImagePlus,
  Plus,
  RotateCcw,
  Save,
  Search,
  Send,
  Square,
  Trash2,
} from 'lucide-react';
import {
  ALL_QUESTION_TYPES,
  getQuestionTypeLabel,
  type Question,
  type QuestionPackage,
  type QuestionType,
} from '../types/game';
import { CHEST_PRESETS } from '../services/storage';
import {
  deleteQuestionImageApi,
  saveTeacherPackageApi,
  uploadQuestionImageApi,
} from '../services/apiClient';
import {
  getShortAnswerAcceptedList,
  normalizeTrueFalseValue,
  validatePackageForSync,
  validateQuestion,
} from './questionValidation';
import { PixelConfirmModal, QuestionPreviewModal } from './QuestionPreviewModal';
import { sounds } from '../services/audio';

interface QuestionEditorPanelProps {
  pkg: QuestionPackage;
  onPackageSaved: (updated: QuestionPackage) => void;
  onGoToSync: (pkgId: string) => void;
}

export const QuestionEditorPanel: React.FC<QuestionEditorPanelProps> = ({
  pkg,
  onPackageSaved,
  onGoToSync,
}) => {
  const [draft, setDraft] = useState<QuestionPackage>(() => structuredClone(pkg));
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'errors'>('all');

  // Image upload tracking per questionId
  const [uploadingImageForId, setUploadingImageForId] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const targetImageQuestionIndexRef = useRef<number | null>(null);

  // Modals
  const [previewQuestion, setPreviewQuestion] = useState<Question | null>(null);
  const [confirmDeleteIdx, setConfirmDeleteIdx] = useState<number | null>(null);
  const [confirmRemoveImgIdx, setConfirmRemoveImgIdx] = useState<number | null>(null);

  // Sync local draft when switching packages
  useEffect(() => {
    setDraft(structuredClone(pkg));
    setHasUnsavedChanges(false);
    setNotice(null);
  }, [pkg.id, pkg.updatedAt]);

  const validation = useMemo(() => validatePackageForSync(draft), [draft]);

  const updateDraft = (updater: (prev: QuestionPackage) => QuestionPackage) => {
    setDraft((prev) => updater(prev));
    setHasUnsavedChanges(true);
    setNotice(null);
  };

  const handleUpdateQuestion = (index: number, patch: Partial<Question>) => {
    updateDraft((prev) => {
      const nextQuestions = [...prev.questions];
      nextQuestions[index] = {
        ...nextQuestions[index],
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      return { ...prev, questions: nextQuestions };
    });
  };

  const handleAddQuestion = () => {
    const nextNum = draft.questions.length + 1;
    const preset = CHEST_PRESETS[(nextNum - 1) % CHEST_PRESETS.length];
    const newQ: Question = {
      id: `q-edit-${Date.now()}-${nextNum}`,
      number: nextNum,
      type: 'multiple_choice',
      prompt: '',
      options: [
        { id: 'A', text: '' },
        { id: 'B', text: '' },
        { id: 'C', text: '' },
        { id: 'D', text: '' },
      ],
      correctAnswer: 'A',
      points: 10,
      isActive: true,
      needsReview: false,
      sourceMeta: { sourceType: 'manual', confidence: 'high' },
      chestPosition: preset,
      locationName: preset.name,
    };
    updateDraft((prev) => ({
      ...prev,
      questions: [...prev.questions, newQ],
    }));
    sounds.playClick();
  };

  const handleDuplicateQuestion = (index: number) => {
    const src = draft.questions[index];
    if (!src) return;
    const clone: Question = {
      ...structuredClone(src),
      id: `q-dup-${Date.now()}-${index + 1}`,
      prompt: src.prompt ? `${src.prompt} (Salinan)` : '',
      updatedAt: new Date().toISOString(),
    };
    updateDraft((prev) => {
      const next = [...prev.questions];
      next.splice(index + 1, 0, clone);
      return {
        ...prev,
        questions: next.map((q, i) => ({ ...q, number: i + 1 })),
      };
    });
    sounds.playClick();
  };

  const handleMoveQuestion = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= draft.questions.length) return;
    updateDraft((prev) => {
      const next = [...prev.questions];
      const temp = next[index];
      next[index] = next[target];
      next[target] = temp;
      return {
        ...prev,
        questions: next.map((q, i) => ({ ...q, number: i + 1 })),
      };
    });
    sounds.playClick();
  };

  const handleConfirmDeleteQuestion = () => {
    if (confirmDeleteIdx === null) return;
    const idxToDelete = confirmDeleteIdx;
    setConfirmDeleteIdx(null);
    updateDraft((prev) => ({
      ...prev,
      questions: prev.questions
        .filter((_, idx) => idx !== idxToDelete)
        .map((q, i) => ({ ...q, number: i + 1 })),
    }));
    sounds.playClick();
  };

  const handleTriggerImageUpload = (qIdx: number) => {
    targetImageQuestionIndexRef.current = qIdx;
    imageInputRef.current?.click();
  };

  const handleImageFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const qIdx = targetImageQuestionIndexRef.current;
    if (!file || qIdx === null || !draft.questions[qIdx]) return;

    const targetQ = draft.questions[qIdx];
    const allowedExts = ['.png', '.jpg', '.jpeg', '.webp'];
    const lowerName = file.name.toLowerCase();
    if (!allowedExts.some((ext) => lowerName.endsWith(ext))) {
      setNotice({
        type: 'error',
        text: `Format gambar "${file.name}" tidak didukung. Gunakan PNG, JPG/JPEG, atau WEBP.`,
      });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setNotice({
        type: 'error',
        text: `Ukuran gambar "${file.name}" melebihi batas maksimum 2 MB.`,
      });
      return;
    }

    setUploadingImageForId(targetQ.id);
    setNotice(null);
    try {
      const oldImageUrl = targetQ.imageUrl;
      const uploadRes = await uploadQuestionImageApi(file);
      if (!uploadRes.success || !uploadRes.imageUrl) {
        setNotice({ type: 'error', text: uploadRes.message });
        sounds.playWrong();
        return;
      }

      if (oldImageUrl && oldImageUrl.startsWith('/api/question-images/')) {
        void deleteQuestionImageApi(oldImageUrl);
      }

      handleUpdateQuestion(qIdx, {
        imageUrl: uploadRes.imageUrl,
        imageAlt: targetQ.imageAlt || file.name.replace(/\.[^.]+$/, ''),
        imagePosition: targetQ.imagePosition || 'after',
      });
      setNotice({
        type: 'success',
        text: `Gambar untuk Soal #${targetQ.number} berhasil diunggah! Jangan lupa klik "Simpan Draf".`,
      });
      sounds.playCorrect();
    } finally {
      setUploadingImageForId(null);
    }
  };

  const handleConfirmRemoveImage = async () => {
    if (confirmRemoveImgIdx === null) return;
    const idx = confirmRemoveImgIdx;
    setConfirmRemoveImgIdx(null);
    const q = draft.questions[idx];
    if (!q) return;

    if (q.imageUrl && q.imageUrl.startsWith('/api/question-images/')) {
      await deleteQuestionImageApi(q.imageUrl);
    }
    handleUpdateQuestion(idx, {
      imageUrl: undefined,
      imageAlt: undefined,
    });
    sounds.playClick();
  };

  const handleRevertChanges = () => {
    setDraft(structuredClone(pkg));
    setHasUnsavedChanges(false);
    setNotice({ type: 'success', text: 'Perubahan yang belum disimpan telah dibatalkan.' });
    sounds.playClick();
  };

  const handleSaveDraft = async (): Promise<QuestionPackage | null> => {
    if (isSaving) return null;
    if (!(draft.title || '').trim()) {
      setNotice({ type: 'error', text: 'Judul paket soal tidak boleh kosong.' });
      return null;
    }
    setIsSaving(true);
    setNotice(null);
    try {
      const res = await saveTeacherPackageApi({
        ...draft,
        questions: draft.questions.map((q, idx) => ({ ...q, number: idx + 1 })),
      });
      if (res.success && res.package) {
        setDraft(structuredClone(res.package));
        setHasUnsavedChanges(false);
        onPackageSaved(res.package);
        setNotice({ type: 'success', text: res.message });
        sounds.playCorrect();
        return res.package;
      } else {
        setNotice({ type: 'error', text: res.message });
        sounds.playWrong();
        return null;
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAndGoToSync = async () => {
    const saved = hasUnsavedChanges ? await handleSaveDraft() : draft;
    if (saved) {
      onGoToSync(saved.id);
    }
  };

  const filteredQuestions = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return draft.questions
      .map((q, originalIndex) => ({ q, originalIndex }))
      .filter(({ q }) => {
        if (statusFilter === 'active' && q.isActive === false) return false;
        if (statusFilter === 'inactive' && q.isActive !== false) return false;
        if (statusFilter === 'errors') {
          const val = validateQuestion(q, draft.questions);
          if (val.valid && !q.needsReview) return false;
        }
        if (query) {
          const inPrompt = q.prompt.toLowerCase().includes(query);
          const inOpts = (q.options || []).some((o) => o.text.toLowerCase().includes(query));
          const inPairs = (q.matchingPairs || []).some(
            (p) => p.left.toLowerCase().includes(query) || p.right.toLowerCase().includes(query)
          );
          const inShort = getShortAnswerAcceptedList(q).some((a) => a.toLowerCase().includes(query));
          if (
            !inPrompt &&
            !inOpts &&
            !inPairs &&
            !inShort &&
            !String(q.number).includes(query) &&
            !String(q.questionNumber || '').includes(query)
          ) {
            return false;
          }
        }
        return true;
      });
  }, [draft.questions, searchTerm, statusFilter]);

  return (
    <div className="space-y-4">
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
        onChange={(e) => void handleImageFileSelected(e)}
        className="hidden"
      />

      {/* Sticky Action Bar */}
      <div className="px-card-gold p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm sm:text-base font-bold text-[#facc15]">
              EDITOR &amp; PRATINJAU: {draft.title || 'Paket Tanpa Judul'}
            </h2>
            {hasUnsavedChanges && (
              <span className="px-badge bg-amber-950 border-[#facc15] text-[#facc15]">
                Belum Disimpan
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#cbb7eb]">
            <span>{validation.activeCount} Soal Aktif</span>
            <span>•</span>
            <span>{validation.inactiveCount} Nonaktif</span>
            <span>•</span>
            <span className="text-[#4ade80]">
              {validation.matchedKeysCount} Kunci Terverifikasi
            </span>
            <span>•</span>
            {validation.errorCount > 0 ? (
              <span className="text-[#f87171] font-bold">
                {validation.errorCount} Error Validasi Wajib Diperbaiki
              </span>
            ) : (
              <span className="text-[#4ade80] font-bold">Semua Soal Aktif Valid</span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasUnsavedChanges && (
            <button
              type="button"
              onClick={handleRevertChanges}
              className="px-btn px-btn-dark px-3 py-2 text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Urungkan</span>
            </button>
          )}

          <button
            type="button"
            disabled={isSaving}
            onClick={() => void handleSaveDraft()}
            className="px-btn px-btn-purple px-4 py-2 text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSaving ? 'Menyimpan...' : 'Simpan Draf'}</span>
          </button>

          <button
            type="button"
            disabled={isSaving}
            onClick={() => void handleSaveAndGoToSync()}
            className="px-btn px-btn-gold px-4 py-2 text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Lanjut Sinkronisasi Game</span>
          </button>
        </div>
      </div>

      {notice && (
        <div
          className={`px-card p-3 text-xs font-bold flex items-center gap-2 ${
            notice.type === 'success'
              ? 'border-[#22c55e] bg-emerald-950/90 text-emerald-200'
              : 'border-[#ef4444] bg-red-950/90 text-red-200'
          }`}
        >
          {notice.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-[#22c55e] shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-[#ef4444] shrink-0" />
          )}
          <span>{notice.text}</span>
        </div>
      )}

      {/* Package Metadata Form */}
      <div className="px-card p-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <div>
          <label className="block font-bold text-[#facc15] mb-1">Judul Paket Soal:</label>
          <input
            type="text"
            value={draft.title}
            onChange={(e) => updateDraft((p) => ({ ...p, title: e.target.value }))}
            className="px-input w-full px-3 py-2 text-xs"
            placeholder="Judul paket kuis..."
          />
        </div>
        <div>
          <label className="block font-bold text-[#facc15] mb-1">Jenjang / Kelas:</label>
          <input
            type="text"
            value={draft.gradeLevel}
            onChange={(e) => updateDraft((p) => ({ ...p, gradeLevel: e.target.value }))}
            className="px-input w-full px-3 py-2 text-xs"
            placeholder="Misal: Kelas 5 SD"
          />
        </div>
        <div className="flex flex-col justify-end gap-1.5">
          <label className="flex items-center gap-2 cursor-pointer text-[#f8f4ff]">
            <input
              type="checkbox"
              checked={draft.showInstantFeedback !== false}
              onChange={(e) =>
                updateDraft((p) => ({ ...p, showInstantFeedback: e.target.checked }))
              }
              className="accent-[#facc15]"
            />
            <span>Feedback langsung setelah jawab</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-[#f8f4ff]">
            <input
              type="checkbox"
              checked={Boolean(draft.isSequential)}
              onChange={(e) => updateDraft((p) => ({ ...p, isSequential: e.target.checked }))}
              className="accent-[#facc15]"
            />
            <span>Peti wajib dibuka berurutan</span>
          </label>
        </div>
        <div className="md:col-span-3">
          <label className="block font-bold text-[#cbb7eb] mb-1">Deskripsi Paket:</label>
          <input
            type="text"
            value={draft.description}
            onChange={(e) => updateDraft((p) => ({ ...p, description: e.target.value }))}
            className="px-input w-full px-3 py-1.5 text-xs"
          />
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="px-card p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="w-4 h-4 text-[#cbb7eb] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Cari teks soal, opsi, atau nomor..."
            className="px-input w-full pl-9 pr-3 py-1.5 text-xs"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {(
            [
              ['all', `Semua (${draft.questions.length})`],
              ['active', `Aktif (${validation.activeCount})`],
              ['inactive', `Nonaktif (${validation.inactiveCount})`],
              ['errors', `Perlu Perbaikan`],
            ] as const
          ).map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => setStatusFilter(val)}
              className={`px-btn px-3 py-1.5 text-xs cursor-pointer ${
                statusFilter === val ? 'px-btn-pink' : 'px-btn-dark'
              }`}
            >
              {label}
            </button>
          ))}

          <button
            type="button"
            onClick={handleAddQuestion}
            className="px-btn px-btn-gold px-3.5 py-1.5 text-xs flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Tambah Soal</span>
          </button>
        </div>
      </div>

      {/* Question Cards */}
      <div className="space-y-4">
        {filteredQuestions.map(({ q, originalIndex }) => {
          const qVal = validateQuestion(q, draft.questions);
          const isActive = q.isActive !== false;
          const isUploadingImg = uploadingImageForId === q.id;

          return (
            <div
              key={`${q.id}-${originalIndex}`}
              className={`px-card p-4 space-y-3 ${
                !isActive
                  ? 'opacity-70 border-[#4c1d95]'
                  : !qVal.valid
                  ? 'border-[#ef4444]'
                  : q.needsReview
                  ? 'border-[#f472b6]'
                  : ''
              }`}
            >
              {/* Top Controls Row */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#4c1d95]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-font-display px-2.5 py-1 bg-[#facc15] text-[#1f0e38] font-bold text-xs border-2 border-[#0a0414]">
                    #{q.number}
                  </span>

                  <select
                    value={q.type}
                    onChange={(e) => {
                      const nextType = e.target.value as QuestionType;
                      const defaultOpts =
                        q.options && q.options.length >= 2
                          ? q.options
                          : [
                              { id: 'A', text: '' },
                              { id: 'B', text: '' },
                              { id: 'C', text: '' },
                              { id: 'D', text: '' },
                            ];
                      const patch: Partial<Question> = { type: nextType };
                      if (nextType === 'multiple_choice' || nextType === 'multiple_choice_complex') {
                        patch.options = defaultOpts;
                        if (nextType === 'multiple_choice_complex' && !q.correctAnswers) {
                          patch.correctAnswers = q.correctAnswer ? [q.correctAnswer] : [];
                        }
                      } else if (nextType === 'matching') {
                        patch.matchingPairs =
                          q.matchingPairs && q.matchingPairs.length >= 2
                            ? q.matchingPairs
                            : [
                                { id: '1', left: '', right: '' },
                                { id: '2', left: '', right: '' },
                              ];
                      } else if (nextType === 'true_false') {
                        const tf =
                          typeof q.correctBoolean === 'boolean'
                            ? q.correctBoolean
                            : normalizeTrueFalseValue(q.correctAnswer);
                        if (tf !== null) {
                          patch.correctBoolean = tf;
                          patch.correctAnswer = tf ? 'Benar' : 'Salah';
                        }
                      } else if (nextType === 'essay') {
                        patch.needsReview = false;
                        patch.answerStatus = 'manual_only';
                      }
                      handleUpdateQuestion(originalIndex, patch);
                    }}
                    className="px-input px-2.5 py-1 text-xs font-bold text-[#facc15]"
                  >
                    {ALL_QUESTION_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {getQuestionTypeLabel(t)}
                      </option>
                    ))}
                  </select>

                  {q.questionNumber && q.questionNumber !== q.number && (
                    <span className="px-badge bg-[#140924] border-[#6d28d9] text-[#cbb7eb] text-[10px]">
                      No. Dok #{q.questionNumber}
                    </span>
                  )}

                  {q.answerSource && q.answerSource !== 'none' && (
                    <span className="px-badge bg-emerald-950 border-[#22c55e] text-emerald-300 text-[10px]">
                      {q.answerSource === 'pdf_answer_key'
                        ? 'Kunci PDF'
                        : q.answerSource === 'pdf_inline_key'
                        ? 'Inline PDF'
                        : q.answerSource === 'word_answer_key'
                        ? 'Kunci Word'
                        : q.answerSource === 'ocr_answer_key'
                        ? 'OCR'
                        : q.answerSource === 'drive_answer_key'
                        ? 'Drive'
                        : 'Manual'}
                    </span>
                  )}

                  <div className="flex items-center gap-1 text-xs">
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={q.points}
                      onChange={(e) =>
                        handleUpdateQuestion(originalIndex, {
                          points: Math.max(1, parseInt(e.target.value, 10) || 10),
                        })
                      }
                      className="px-input w-14 px-2 py-1 text-xs text-center font-bold"
                    />
                    <span className="text-[#cbb7eb]">Poin</span>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      handleUpdateQuestion(originalIndex, { isActive: !isActive })
                    }
                    className={`px-btn px-2.5 py-1 text-[11px] flex items-center gap-1 cursor-pointer ${
                      isActive ? 'px-btn-green' : 'px-btn-dark'
                    }`}
                    title={isActive ? 'Aktif di Game 3D' : 'Dinonaktifkan dari Game 3D'}
                  >
                    {isActive ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                    <span>{isActive ? 'Aktif' : 'Nonaktif'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      handleUpdateQuestion(originalIndex, {
                        needsReview: !q.needsReview,
                        answerStatus: !q.needsReview ? 'needs_review' : q.type === 'essay' ? 'manual_only' : 'verified',
                      })
                    }
                    className={`px-btn px-2.5 py-1 text-[11px] flex items-center gap-1 cursor-pointer ${
                      q.needsReview ? 'px-btn-pink' : 'px-btn-dark'
                    }`}
                  >
                    <Flag className="w-3 h-3" />
                    <span>{q.needsReview ? 'NEEDS_REVIEW' : 'Terverifikasi'}</span>
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPreviewQuestion(q)}
                    className="px-btn px-btn-gold px-2.5 py-1 text-[11px] flex items-center gap-1 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Pratinjau Game</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDuplicateQuestion(originalIndex)}
                    className="px-btn px-btn-dark p-1.5 cursor-pointer"
                    title="Duplikasi Soal"
                    aria-label={`Duplikasi Soal ${q.number}`}
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={originalIndex === 0}
                    onClick={() => handleMoveQuestion(originalIndex, -1)}
                    className="px-btn px-btn-dark p-1.5 cursor-pointer"
                    title="Naikkan Urutan"
                    aria-label={`Naikkan Urutan Soal ${q.number}`}
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={originalIndex === draft.questions.length - 1}
                    onClick={() => handleMoveQuestion(originalIndex, 1)}
                    className="px-btn px-btn-dark p-1.5 cursor-pointer"
                    title="Turunkan Urutan"
                    aria-label={`Turunkan Urutan Soal ${q.number}`}
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteIdx(originalIndex)}
                    className="px-btn px-btn-red p-1.5 cursor-pointer"
                    title="Hapus Soal"
                    aria-label={`Hapus Soal ${q.number}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Validation Error / Warning Strip */}
              {qVal.errors.length > 0 && (
                <div className="p-2.5 bg-red-950/85 border-2 border-[#ef4444] text-red-100 text-xs space-y-0.5">
                  {qVal.errors.map((err, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-[#ef4444] shrink-0" />
                      <span>{err}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Prompt + Instructions */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                <div className="lg:col-span-8 space-y-2">
                  <div>
                    <label className="block text-[11px] font-bold text-[#cbb7eb] mb-1">
                      Instruksi Khusus Soal (Opsional):
                    </label>
                    <input
                      type="text"
                      value={q.instructions || ''}
                      onChange={(e) =>
                        handleUpdateQuestion(originalIndex, { instructions: e.target.value })
                      }
                      placeholder="Contoh: Amati gambar berikut sebelum menjawab..."
                      className="px-input w-full px-3 py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#facc15] mb-1">
                      Teks Pertanyaan:
                    </label>
                    <textarea
                      value={q.prompt}
                      onChange={(e) =>
                        handleUpdateQuestion(originalIndex, { prompt: e.target.value })
                      }
                      rows={3}
                      placeholder="Tuliskan pertanyaan soal..."
                      className="px-input w-full p-2.5 text-sm leading-snug"
                    />
                  </div>
                </div>

                {/* Manual Image Attachment Box */}
                <div className="lg:col-span-4 px-subcard p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-[#f472b6]">
                      Gambar Soal (Manual)
                    </span>
                    <button
                      type="button"
                      disabled={isUploadingImg}
                      onClick={() => handleTriggerImageUpload(originalIndex)}
                      className="px-btn px-btn-pink px-2.5 py-1 text-[10px] flex items-center gap-1 cursor-pointer"
                    >
                      <ImagePlus className="w-3 h-3" />
                      <span>
                        {isUploadingImg
                          ? 'Mengunggah...'
                          : q.imageUrl
                          ? 'Ganti Gambar'
                          : 'Unggah Gambar'}
                      </span>
                    </button>
                  </div>

                  {q.imageUrl ? (
                    <div className="space-y-2">
                      <div className="bg-[#090312] border border-[#4c1d95] p-1.5 text-center">
                        <img
                          src={q.imageUrl}
                          alt={q.imageAlt || 'Pratinjau gambar soal'}
                          className="max-h-28 w-auto mx-auto object-contain"
                        />
                      </div>

                      <input
                        type="text"
                        value={q.imageAlt || ''}
                        onChange={(e) =>
                          handleUpdateQuestion(originalIndex, { imageAlt: e.target.value })
                        }
                        placeholder="Deskripsi gambar (alt text)..."
                        className="px-input w-full px-2 py-1 text-[11px]"
                      />

                      <div className="flex items-center justify-between gap-2">
                        <select
                          value={q.imagePosition || 'after'}
                          onChange={(e) =>
                            handleUpdateQuestion(originalIndex, {
                              imagePosition: e.target.value as 'before' | 'after',
                            })
                          }
                          className="px-input px-2 py-1 text-[11px] flex-1"
                        >
                          <option value="before">Posisi: Sebelum Pertanyaan</option>
                          <option value="after">Posisi: Sesudah Pertanyaan</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => setConfirmRemoveImgIdx(originalIndex)}
                          className="px-btn px-btn-red px-2 py-1 text-[10px] cursor-pointer"
                        >
                          Hapus
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] text-[#cbb7eb] py-4 text-center border border-dashed border-[#6d28d9]">
                      Belum ada gambar. Mendukung PNG, JPG/JPEG, WEBP (maks 2 MB).
                    </div>
                  )}
                </div>
              </div>

              {/* Type-Specific Answers */}
              {q.type === 'multiple_choice' && (
                <div className="space-y-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-[#facc15]">Opsi Jawaban &amp; Kunci Tunggal:</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[#cbb7eb]">
                        Kunci Aktif:{' '}
                        <strong className={q.correctAnswer ? 'text-[#4ade80]' : 'text-[#f87171]'}>
                          {q.correctAnswer || 'Belum ditentukan'}
                        </strong>
                      </span>
                      {(q.options || []).length < 5 && (
                        <button
                          type="button"
                          onClick={() => {
                            const nextId = String.fromCharCode(65 + (q.options || []).length);
                            handleUpdateQuestion(originalIndex, {
                              options: [...(q.options || []), { id: nextId, text: '' }],
                            });
                          }}
                          className="px-btn px-btn-dark px-2 py-0.5 text-[10px] cursor-pointer"
                        >
                          + Opsi
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(q.options || []).map((opt, oIdx) => {
                      const isKey = q.correctAnswer?.trim().toUpperCase() === opt.id.trim().toUpperCase();
                      return (
                        <div
                          key={opt.id}
                          className={`px-subcard p-2 flex items-center gap-2 ${
                            isKey ? 'border-[#22c55e]' : ''
                          }`}
                        >
                          <span className="font-bold text-[#facc15] w-5 text-center">{opt.id}.</span>
                          <input
                            type="text"
                            value={opt.text}
                            onChange={(e) => {
                              const nextOpts = [...(q.options || [])];
                              nextOpts[oIdx] = { ...nextOpts[oIdx], text: e.target.value };
                              handleUpdateQuestion(originalIndex, { options: nextOpts });
                            }}
                            placeholder={`Isi opsi ${opt.id}...`}
                            className="px-input flex-1 px-2 py-1 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdateQuestion(originalIndex, {
                                correctAnswer: isKey ? undefined : opt.id,
                                needsReview: false,
                                answerSource: 'manual',
                                answerStatus: isKey ? 'needs_review' : 'verified',
                              })
                            }
                            className={`px-btn px-2 py-1 text-[10px] inline-flex items-center gap-1 cursor-pointer ${
                              isKey ? 'px-btn-green' : 'px-btn-dark'
                            }`}
                          >
                            {isKey && <Check className="w-3 h-3" />}
                            <span>{isKey ? 'Kunci' : 'Set Kunci'}</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {q.type === 'multiple_choice_complex' && (() => {
                const selectedKeys = new Set(
                  (Array.isArray(q.correctAnswers) ? q.correctAnswers : []).map((k) =>
                    k.trim().toUpperCase()
                  )
                );
                return (
                  <div className="space-y-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-[#facc15]">
                        Opsi Pilihan Ganda Kompleks (Pilih &gt;1 Kunci Benar):
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[#cbb7eb]">
                          Kunci Aktif:{' '}
                          <strong className={selectedKeys.size > 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}>
                            {selectedKeys.size > 0 ? Array.from(selectedKeys).sort().join(', ') : 'Belum ditentukan'}
                          </strong>
                        </span>
                        {(q.options || []).length < 5 && (
                          <button
                            type="button"
                            onClick={() => {
                              const nextId = String.fromCharCode(65 + (q.options || []).length);
                              handleUpdateQuestion(originalIndex, {
                                options: [...(q.options || []), { id: nextId, text: '' }],
                              });
                            }}
                            className="px-btn px-btn-dark px-2 py-0.5 text-[10px] cursor-pointer"
                          >
                            + Opsi
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {(q.options || []).map((opt, oIdx) => {
                        const optUpper = opt.id.trim().toUpperCase();
                        const isKey = selectedKeys.has(optUpper);
                        return (
                          <div
                            key={opt.id}
                            className={`px-subcard p-2 flex items-center gap-2 ${
                              isKey ? 'border-[#22c55e]' : ''
                            }`}
                          >
                            <span className="font-bold text-[#facc15] w-5 text-center">{opt.id}.</span>
                            <input
                              type="text"
                              value={opt.text}
                              onChange={(e) => {
                                const nextOpts = [...(q.options || [])];
                                nextOpts[oIdx] = { ...nextOpts[oIdx], text: e.target.value };
                                handleUpdateQuestion(originalIndex, { options: nextOpts });
                              }}
                              placeholder={`Isi opsi ${opt.id}...`}
                              className="px-input flex-1 px-2 py-1 text-xs"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const nextSet = new Set(selectedKeys);
                                if (isKey) nextSet.delete(optUpper);
                                else nextSet.add(optUpper);
                                const nextArr = Array.from(nextSet).sort();
                                handleUpdateQuestion(originalIndex, {
                                  correctAnswers: nextArr,
                                  correctAnswer: nextArr.join(', ') || undefined,
                                  needsReview: nextArr.length === 0,
                                  answerSource: 'manual',
                                  answerStatus: nextArr.length > 0 ? 'verified' : 'needs_review',
                                });
                              }}
                              className={`px-btn px-2 py-1 text-[10px] inline-flex items-center gap-1 cursor-pointer ${
                                isKey ? 'px-btn-green' : 'px-btn-dark'
                              }`}
                            >
                              {isKey ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
                              <span>{isKey ? 'Benar' : 'Pilih'}</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {q.type === 'true_false' && (() => {
                const tfVal =
                  typeof q.correctBoolean === 'boolean'
                    ? q.correctBoolean
                    : normalizeTrueFalseValue(q.correctAnswer);
                return (
                  <div className="space-y-2 text-xs">
                    <span className="block font-bold text-[#facc15]">
                      Kunci Jawaban Benar / Salah:
                    </span>
                    <div className="grid grid-cols-2 gap-2.5 max-w-md">
                      {([
                        { label: 'BENAR', val: true },
                        { label: 'SALAH', val: false },
                      ] as const).map((item) => {
                        const active = tfVal === item.val;
                        return (
                          <button
                            key={item.label}
                            type="button"
                            onClick={() =>
                              handleUpdateQuestion(originalIndex, {
                                correctBoolean: item.val,
                                correctAnswer: item.val ? 'Benar' : 'Salah',
                                needsReview: false,
                                answerSource: 'manual',
                                answerStatus: 'verified',
                              })
                            }
                            className={`px-btn py-2 px-4 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                              active ? 'px-btn-green' : 'px-btn-dark'
                            }`}
                          >
                            {active && <Check className="w-3.5 h-3.5" />}
                            <span>{item.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {q.type === 'matching' && (() => {
                const pairs = Array.isArray(q.matchingPairs) ? q.matchingPairs : [];
                return (
                  <div className="space-y-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-[#facc15]">
                        Pasangan Menjodohkan (Item Kiri &harr; Jawaban Kanan):
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const nextId = String(pairs.length + 1);
                          handleUpdateQuestion(originalIndex, {
                            matchingPairs: [...pairs, { id: nextId, left: '', right: '' }],
                          });
                        }}
                        className="px-btn px-btn-gold px-2.5 py-1 text-[10px] flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Tambah Pasangan</span>
                      </button>
                    </div>
                    <div className="space-y-2">
                      {pairs.map((pair, pIdx) => (
                        <div key={pair.id || pIdx} className="px-subcard p-2 flex flex-wrap sm:flex-nowrap items-center gap-2">
                          <span className="font-bold text-[#facc15] w-5 text-center">{pIdx + 1}.</span>
                          <input
                            type="text"
                            value={pair.left}
                            onChange={(e) => {
                              const next = [...pairs];
                              next[pIdx] = { ...next[pIdx], left: e.target.value };
                              handleUpdateQuestion(originalIndex, { matchingPairs: next });
                            }}
                            placeholder="Pernyataan / Item Kiri..."
                            className="px-input flex-1 px-2.5 py-1.5 text-xs"
                          />
                          <span className="text-[#f472b6] font-bold">&harr;</span>
                          <input
                            type="text"
                            value={pair.right}
                            onChange={(e) => {
                              const next = [...pairs];
                              next[pIdx] = { ...next[pIdx], right: e.target.value };
                              handleUpdateQuestion(originalIndex, {
                                matchingPairs: next,
                                needsReview: next.some((it) => !it.left.trim() || !it.right.trim()),
                              });
                            }}
                            placeholder="Pasangan Jawaban Kanan..."
                            className="px-input flex-1 px-2.5 py-1.5 text-xs"
                          />
                          {pairs.length > 2 && (
                            <button
                              type="button"
                              onClick={() => {
                                const next = pairs
                                  .filter((_, i) => i !== pIdx)
                                  .map((it, i) => ({ ...it, id: String(i + 1) }));
                                handleUpdateQuestion(originalIndex, { matchingPairs: next });
                              }}
                              className="px-btn px-btn-red p-1.5 cursor-pointer"
                              aria-label="Hapus pasangan"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {q.type === 'short_answer' && (
                <div className="text-xs">
                  <label className="block font-bold text-[#facc15] mb-1">
                    Variasi Jawaban Diterima (pisahkan dengan tanda &quot;/&quot; atau koma &quot;,&quot;):
                  </label>
                  <input
                    type="text"
                    value={getShortAnswerAcceptedList(q).join(' / ')}
                    onChange={(e) => {
                      const vals = e.target.value
                        .split(/[\/,;]+/)
                        .map((s) => s.trim())
                        .filter(Boolean);
                      handleUpdateQuestion(originalIndex, {
                        acceptedAnswers: vals.length > 0 ? vals : undefined,
                        keywords: vals.length > 0 ? vals : undefined,
                        correctAnswer: vals[0],
                        needsReview: vals.length === 0,
                        answerSource: vals.length > 0 ? 'manual' : 'none',
                        answerStatus: vals.length > 0 ? 'verified' : 'needs_review',
                      });
                    }}
                    placeholder="Contoh: fotosintesis / proses fotosintesis"
                    className="px-input w-full px-3 py-1.5 text-xs"
                  />
                </div>
              )}

              {q.type === 'essay' && (
                <div className="text-xs space-y-1">
                  <label className="block font-bold text-[#facc15]">
                    Rubrik / Pedoman Penilaian Esai (Opsional — Tidak Memblokir Terbit):
                  </label>
                  <input
                    type="text"
                    value={q.essayRubric || ''}
                    onChange={(e) =>
                      handleUpdateQuestion(originalIndex, {
                        essayRubric: e.target.value,
                        needsReview: false,
                        answerStatus: e.target.value.trim() ? 'verified' : 'manual_only',
                      })
                    }
                    placeholder="Kriteria jawaban benar untuk panduan koreksi manual guru..."
                    className="px-input w-full px-3 py-1.5 text-xs"
                  />
                </div>
              )}

              {/* Pembahasan / Penjelasan */}
              <div className="text-xs">
                <label className="block font-bold text-[#cbb7eb] mb-1">
                  Pembahasan Soal (ditampilkan ke siswa setelah menjawab):
                </label>
                <input
                  type="text"
                  value={q.explanation || ''}
                  onChange={(e) =>
                    handleUpdateQuestion(originalIndex, { explanation: e.target.value })
                  }
                  placeholder="Tuliskan penjelasan mengapa jawaban tersebut benar..."
                  className="px-input w-full px-3 py-1.5 text-xs"
                />
              </div>
            </div>
          );
        })}

        {filteredQuestions.length === 0 && (
          <div className="px-card p-8 text-center text-xs text-[#cbb7eb] space-y-2">
            <div>Tidak ada soal yang cocok dengan filter pencarian Anda.</div>
            <button
              type="button"
              onClick={() => {
                setSearchTerm('');
                setStatusFilter('all');
              }}
              className="px-btn px-btn-dark px-4 py-1.5 text-xs cursor-pointer"
            >
              Reset Filter
            </button>
          </div>
        )}
      </div>

      {/* Modals */}
      {previewQuestion && (
        <QuestionPreviewModal
          question={previewQuestion}
          onClose={() => setPreviewQuestion(null)}
        />
      )}

      {confirmDeleteIdx !== null && (
        <PixelConfirmModal
          title="Hapus Soal dari Paket?"
          message={`Apakah Anda yakin ingin menghapus Soal #${
            draft.questions[confirmDeleteIdx]?.number || confirmDeleteIdx + 1
          }? Perubahan baru permanen setelah Anda menekan "Simpan Draf".`}
          confirmLabel="Ya, Hapus Soal"
          onConfirm={handleConfirmDeleteQuestion}
          onCancel={() => setConfirmDeleteIdx(null)}
        />
      )}

      {confirmRemoveImgIdx !== null && (
        <PixelConfirmModal
          title="Hapus Gambar Soal?"
          message="Gambar yang terpasang pada soal ini akan dilepas dan dihapus dari server."
          confirmLabel="Ya, Hapus Gambar"
          onConfirm={() => void handleConfirmRemoveImage()}
          onCancel={() => setConfirmRemoveImgIdx(null)}
        />
      )}
    </div>
  );
};
