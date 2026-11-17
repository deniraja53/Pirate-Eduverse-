/**
 * PDF Question Extractor, Validator & Interactive Draft/Publish Editor (V4)
 * - Enforces strict <= 2 MB (2,097,152 bytes) PDF limit on frontend before upload
 * - Checks PDF MIME type and %PDF- magic bytes
 * - Uses XHR backend upload (/api/teacher/pdf/upload) with real progress, replace, & cancel
 * - Detects scanned PDFs cleanly without faking OCR; provides explicit OCR flow when enabled
 * - Lets teacher edit, add, delete, reorder, flag, set missing keys, and Save Draft or Publish
 * Created by Deni Raja99
 */

import React, { useRef, useState } from 'react';
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  ScanText,
  Save,
  Rocket,
  XCircle,
  RefreshCw,
  Flag,
} from 'lucide-react';
import type { PdfExtractionResult, Question, QuestionPackage } from '../types/game';
import { CHEST_PRESETS } from '../services/storage';
import {
  publishTeacherPackageApi,
  saveTeacherPackageApi,
  uploadPdfWithProgress,
} from '../services/apiClient';
import { sounds } from '../services/audio';

const MAX_PDF_BYTES = 2 * 1024 * 1024; // 2,097,152 bytes

interface PdfImporterProps {
  onSavedPackage: (pkg: QuestionPackage, published: boolean) => void;
  onCancel: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const PdfImporter: React.FC<PdfImporterProps> = ({ onSavedPackage, onCancel }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortUploadRef = useRef<(() => void) | null>(null);
  const inFlightLockRef = useRef(false);

  // Selected File & Upload Progress
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isRunningOcr, setIsRunningOcr] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Extraction state
  const [extractionResult, setExtractionResult] = useState<PdfExtractionResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [statusMsg, setStatusMsg] = useState('');

  // Draft quiz editor state
  const [activeStep, setActiveStep] = useState<'upload' | 'review'>('upload');
  const [quizTitle, setQuizTitle] = useState('');
  const [gradeLevel, setGradeLevel] = useState('Kelas 5 SD');
  const [description, setDescription] = useState('Paket soal petualangan hasil ekstraksi PDF.');
  const [showInstantFeedback, setShowInstantFeedback] = useState(true);
  const [isSequential, setIsSequential] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [savedPackageId, setSavedPackageId] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  const validateAndUploadPdf = async (file: File) => {
    if (inFlightLockRef.current) return;

    setErrorMsg('');
    setStatusMsg('');
    setExtractionResult(null);

    // 1. Validate extension and MIME type before reading/uploading
    const lowerName = file.name.toLowerCase();
    const isPdfExtension = lowerName.endsWith('.pdf');
    const isPdfMime = !file.type || file.type === 'application/pdf' || file.type === 'application/x-pdf';
    if (!isPdfExtension || !isPdfMime) {
      setErrorMsg(
        `Format file "${file.name}" tidak valid. Hanya file PDF (.pdf) yang diperbolehkan.`
      );
      return;
    }

    // 2. Reject > 2 MB on frontend BEFORE starting upload
    if (file.size === 0) {
      setErrorMsg('File PDF kosong (0 byte). Silakan pilih file PDF yang berisi soal.');
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setErrorMsg(
        `Ukuran file "${file.name}" (${formatFileSize(
          file.size
        )}) melebihi batas maksimum 2 MB (2.097.152 byte). Unggahan ditolak sebelum dikirim ke server.`
      );
      return;
    }

    // 3. Validate PDF magic signature (%PDF-) on frontend
    try {
      const headerSlice = await file.slice(0, 8).arrayBuffer();
      const headerText = new TextDecoder('ascii').decode(headerSlice);
      if (!headerText.startsWith('%PDF-')) {
        setErrorMsg(
          `File "${file.name}" bukan file PDF asli (header %PDF- tidak ditemukan). Pastikan file tidak rusak atau hasil ubah ekstensi.`
        );
        return;
      }
    } catch {
      setErrorMsg('Gagal memeriksa header file PDF di browser.');
      return;
    }

    // 4. Upload to backend /api/teacher/pdf/upload with real progress
    inFlightLockRef.current = true;
    setSelectedFile(file);
    setIsUploading(true);
    setUploadProgress(0);

    try {
      const result = await uploadPdfWithProgress(
        file,
        '/api/teacher/pdf/upload',
        (pct) => setUploadProgress(pct),
        (abortFn) => {
          abortUploadRef.current = abortFn;
        }
      );

      setExtractionResult(result);
      const baseTitle = file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();
      if (!quizTitle) {
        setQuizTitle(baseTitle || 'Kuis Petualangan PDF');
      }

      if (result.isScanned) {
        setStatusMsg(result.message);
      } else if (result.questions.length > 0) {
        setQuestions(result.questions);
        setSavedPackageId(undefined);
        setActiveStep('review');
        sounds.playCorrect();
      } else {
        setStatusMsg(result.message);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal memproses file PDF.');
      sounds.playWrong();
    } finally {
      inFlightLockRef.current = false;
      abortUploadRef.current = null;
      setIsUploading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset input so selecting same file after replace works
    if (file) {
      void validateAndUploadPdf(file);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void validateAndUploadPdf(file);
    }
  };

  const handleCancelUpload = () => {
    if (abortUploadRef.current) {
      abortUploadRef.current();
    }
    setIsUploading(false);
    setUploadProgress(0);
    inFlightLockRef.current = false;
  };

  const handleReplaceFile = () => {
    if (isUploading) return;
    setSelectedFile(null);
    setExtractionResult(null);
    setErrorMsg('');
    setStatusMsg('');
    setUploadProgress(0);
    fileInputRef.current?.click();
  };

  const handleRunOcr = async () => {
    if (!selectedFile || inFlightLockRef.current) return;
    inFlightLockRef.current = true;
    setIsRunningOcr(true);
    setErrorMsg('');
    setStatusMsg('Menjalankan ekstraksi OCR PDF pada server...');
    setUploadProgress(0);

    try {
      const ocrResult = await uploadPdfWithProgress(
        selectedFile,
        '/api/teacher/pdf/ocr',
        (pct) => setUploadProgress(pct),
        (abortFn) => {
          abortUploadRef.current = abortFn;
        }
      );

      setExtractionResult(ocrResult);
      if (ocrResult.questions && ocrResult.questions.length > 0) {
        setQuestions(ocrResult.questions);
        setSavedPackageId(undefined);
        setActiveStep('review');
        sounds.playCorrect();
      } else {
        setErrorMsg(ocrResult.message || 'OCR selesai tetapi tidak ditemukan butir soal.');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menjalankan OCR pada PDF.');
      sounds.playWrong();
    } finally {
      inFlightLockRef.current = false;
      abortUploadRef.current = null;
      setIsRunningOcr(false);
    }
  };

  const handleStartManualWithSelectedFile = () => {
    const baseTitle = selectedFile
      ? selectedFile.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim()
      : 'Paket Soal Manual';
    if (!quizTitle) setQuizTitle(baseTitle);
    const preset = CHEST_PRESETS[0];
    setQuestions([
      {
        id: `q-manual-${Date.now()}-1`,
        number: 1,
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
        needsReview: true,
        sourceMeta: { sourceType: 'manual', confidence: 'high' },
        chestPosition: preset,
        locationName: preset.name,
      },
    ]);
    setActiveStep('review');
  };

  // Interactive Question Editor handlers
  const handleUpdateQuestion = (index: number, patch: Partial<Question>) => {
    setQuestions((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const handleMoveQuestion = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= questions.length) return;
    setQuestions((prev) => {
      const next = [...prev];
      const temp = next[index];
      next[index] = next[target];
      next[target] = temp;
      return next.map((q, idx) => ({ ...q, number: idx + 1 }));
    });
    sounds.playClick();
  };

  const handleDeleteQuestion = (index: number) => {
    setQuestions((prev) =>
      prev
        .filter((_, idx) => idx !== index)
        .map((q, idx) => ({ ...q, number: idx + 1 }))
    );
    sounds.playClick();
  };

  const handleAddEmptyQuestion = () => {
    const nextNum = questions.length + 1;
    const preset = CHEST_PRESETS[(nextNum - 1) % CHEST_PRESETS.length];
    setQuestions((prev) => [
      ...prev,
      {
        id: `q-add-${Date.now()}-${nextNum}`,
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
        needsReview: true,
        sourceMeta: { sourceType: 'manual', confidence: 'high' },
        chestPosition: preset,
        locationName: preset.name,
      },
    ]);
    sounds.playClick();
  };

  const handlePersistPackage = async (publishImmediately: boolean) => {
    if (isSaving) return;

    const cleanTitle = quizTitle.trim() || 'Paket Soal PDF Baru';
    const validQuestions = questions.filter((q) => q.prompt.trim().length > 0);
    if (validQuestions.length === 0) {
      setErrorMsg('Minimal harus ada 1 soal dengan teks pertanyaan yang terisi.');
      return;
    }

    setErrorMsg('');
    setIsSaving(true);

    try {
      const saveRes = await saveTeacherPackageApi({
        id: savedPackageId,
        title: cleanTitle,
        description: description.trim() || 'Paket soal hasil ekstraksi PDF.',
        gradeLevel: gradeLevel.trim() || 'Semua Kelas SD',
        isSequential,
        showInstantFeedback,
        sourcePdfName: selectedFile?.name,
        sourcePdfSizeBytes: selectedFile?.size,
        questions: validQuestions.map((q, idx) => ({
          ...q,
          number: idx + 1,
        })),
      });

      if (!saveRes.success || !saveRes.package) {
        setErrorMsg(saveRes.message || 'Gagal menyimpan draf paket soal.');
        sounds.playWrong();
        return;
      }

      setSavedPackageId(saveRes.package.id);

      if (!publishImmediately) {
        sounds.playCorrect();
        onSavedPackage(saveRes.package, false);
        return;
      }

      const pubRes = await publishTeacherPackageApi(saveRes.package.id, false);
      if (!pubRes.success || !pubRes.package) {
        setErrorMsg(pubRes.message || 'Draf tersimpan, tetapi gagal menerbitkan paket.');
        sounds.playWrong();
        return;
      }

      sounds.playVictory();
      onSavedPackage(pubRes.package, true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Terjadi kesalahan saat menyimpan paket.');
      sounds.playWrong();
    } finally {
      setIsSaving(false);
    }
  };

  const missingKeyCount = questions.filter(
    (q) => q.type === 'multiple_choice' && !q.correctAnswer
  ).length;
  const needsReviewCount = questions.filter((q) => q.needsReview).length;

  return (
    <div className="bg-slate-900 border border-amber-600/60 rounded-3xl p-5 sm:p-6 text-white space-y-5 shadow-2xl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-amber-800/40">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold font-pirate text-amber-300">
            Unggah PDF & Ekstraktor Soal Otomatis (Maks 2 MB)
          </h2>
          <p className="text-xs text-slate-400">
            Validasi ukuran &lt;= 2 MB, deteksi tipe soal (Pilihan Ganda, Isian Singkat, Esai),
            editor interaktif, serta pemetaan langsung ke peti 3D.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-colors cursor-pointer"
        >
          Tutup
        </button>
      </div>

      {/* STEP 1: UPLOAD */}
      {activeStep === 'upload' && (
        <div className="space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingOver(true);
            }}
            onDragLeave={() => setIsDraggingOver(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-2xl p-6 sm:p-8 text-center transition-colors ${
              isDraggingOver
                ? 'border-amber-300 bg-amber-950/30'
                : 'border-amber-500/50 hover:border-amber-400 bg-slate-950/50'
            }`}
          >
            <Upload className="w-11 h-11 text-amber-400 mx-auto mb-2.5" />
            <div className="font-bold text-sm sm:text-base text-slate-100">
              Seret & Lepas File PDF Soal ke Sini
            </div>
            <p className="text-xs text-slate-400 mt-1 mb-4">
              Hanya format <strong className="text-amber-300">.pdf</strong> • Batas maksimum{' '}
              <strong className="text-amber-300">2 MB (2.097.152 byte)</strong>
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={handleFileChange}
              disabled={isUploading || isRunningOcr}
              className="hidden"
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || isRunningOcr}
              className="inline-flex items-center gap-2 py-2.5 px-6 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-amber-950 font-bold text-xs cursor-pointer shadow-lg transition-colors"
            >
              <FileText className="w-4 h-4" />
              <span>{isUploading ? 'Sedang Mengunggah...' : 'Pilih File PDF (≤ 2 MB)'}</span>
            </button>
          </div>

          {/* Selected File Metadata & Real Progress */}
          {selectedFile && (
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-300 shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white truncate">{selectedFile.name}</div>
                    <div className="text-[11px] text-slate-400">
                      Ukuran: <strong className="text-amber-300">{formatFileSize(selectedFile.size)}</strong>{' '}
                      ({selectedFile.size.toLocaleString('id-ID')} byte)
                      {extractionResult?.pageCount ? ` • ${extractionResult.pageCount} halaman` : ''}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {isUploading ? (
                    <button
                      type="button"
                      onClick={handleCancelUpload}
                      className="px-3 py-1.5 rounded-lg bg-red-950 hover:bg-red-900 border border-red-600/60 text-red-200 text-xs font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Batalkan</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleReplaceFile}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Ganti File</span>
                    </button>
                  )}
                </div>
              </div>

              {(isUploading || isRunningOcr || uploadProgress > 0) && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span>
                      {isRunningOcr
                        ? 'Menjalankan OCR pada dokumen...'
                        : isUploading
                        ? 'Mengunggah & mengekstrak soal PDF...'
                        : 'Proses unggah selesai'}
                    </span>
                    <span className="font-mono text-amber-300 font-bold">{uploadProgress}%</span>
                  </div>
                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-amber-500 to-emerald-500 transition-all duration-200"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Scanned PDF Explicit Flow */}
          {extractionResult?.isScanned && (
            <div className="p-4 bg-amber-950/50 border border-amber-500/60 rounded-2xl space-y-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <div className="font-bold text-amber-200 text-sm">
                    PDF Pindaian (Scan Gambar) Terdeteksi — Tidak Ada Lapisan Teks
                  </div>
                  <p className="text-slate-300 leading-relaxed">
                    {extractionResult.message}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                {extractionResult.ocrAvailable ? (
                  <button
                    type="button"
                    onClick={handleRunOcr}
                    disabled={isRunningOcr}
                    className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-amber-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <ScanText className="w-4 h-4" />
                    <span>{isRunningOcr ? 'Memproses OCR...' : 'Jalankan Ekstraksi OCR Server'}</span>
                  </button>
                ) : (
                  <div className="text-[11px] text-amber-300 bg-slate-950/70 px-3 py-1.5 rounded-lg border border-amber-700/40">
                    Layanan OCR otomatis belum aktif di server (GEMINI_API_KEY belum disetel). Unggah PDF berbasis teks atau input manual.
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleStartManualWithSelectedFile}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs cursor-pointer"
                >
                  Buat Soal Manual di Editor
                </button>
              </div>
            </div>
          )}

          {/* Honest Error or Warning Banner */}
          {errorMsg && (
            <div className="p-3.5 bg-red-950/80 border border-red-500 text-red-200 rounded-xl text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {statusMsg && !extractionResult?.isScanned && (
            <div className="p-3.5 bg-slate-950 border border-amber-600/50 text-amber-200 rounded-xl text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-2">
                <p>{statusMsg}</p>
                <button
                  type="button"
                  onClick={handleStartManualWithSelectedFile}
                  className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-amber-950 font-bold text-xs cursor-pointer"
                >
                  Lanjutkan Input Manual di Editor
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* STEP 2: INTERACTIVE REVIEW & DRAFT/PUBLISH EDITOR */}
      {activeStep === 'review' && (
        <div className="space-y-4">
          {/* Summary Banner */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-emerald-950/40 p-3.5 rounded-2xl border border-emerald-600/40 text-xs">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 text-emerald-300 font-bold">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  {questions.length} Soal Siap Ditinjau ({selectedFile?.name || 'Editor Soal'})
                  {extractionResult?.ocrUsed ? ' • Diekstrak via OCR' : ''}
                </span>
              </div>
              <div className="text-[11px] text-slate-300 flex flex-wrap gap-3">
                {missingKeyCount > 0 && (
                  <span className="text-amber-300 font-semibold">
                    ⚠ {missingKeyCount} soal PG belum memiliki kunci jawaban (ditandai Belum ditentukan)
                  </span>
                )}
                {needsReviewCount > 0 && (
                  <span className="text-amber-300 font-semibold">
                    ⚑ {needsReviewCount} soal ditandai perlu pemeriksaan guru
                  </span>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setActiveStep('upload')}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-bold cursor-pointer"
            >
              ← Unggah File Lain
            </button>
          </div>

          {extractionResult?.warnings && extractionResult.warnings.length > 0 && (
            <div className="p-3 bg-amber-950/40 border border-amber-600/40 rounded-xl text-[11px] text-amber-200 space-y-1">
              {extractionResult.warnings.map((w, i) => (
                <div key={i}>• {w}</div>
              ))}
            </div>
          )}

          {/* Quiz Metadata Form */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-950/80 border border-slate-800 p-4 rounded-2xl text-xs">
            <div>
              <label className="block font-bold text-amber-300 mb-1">Judul Paket Kuis:</label>
              <input
                type="text"
                value={quizTitle}
                onChange={(e) => setQuizTitle(e.target.value)}
                placeholder="Contoh: UTS IPAS Kelas 5"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-amber-400"
              />
            </div>

            <div>
              <label className="block font-bold text-amber-300 mb-1">Jenjang / Kelas:</label>
              <input
                type="text"
                value={gradeLevel}
                onChange={(e) => setGradeLevel(e.target.value)}
                placeholder="Contoh: Kelas 5 SD"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-amber-400"
              />
            </div>

            <div className="flex flex-col justify-end gap-2">
              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={showInstantFeedback}
                  onChange={(e) => setShowInstantFeedback(e.target.checked)}
                  className="accent-amber-500"
                />
                <span>Tampilkan feedback benar/salah langsung</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={isSequential}
                  onChange={(e) => setIsSequential(e.target.checked)}
                  className="accent-amber-500"
                />
                <span>Peti wajib dibuka berurutan</span>
              </label>
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 bg-red-950/80 border border-red-500 text-red-200 rounded-xl text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Question List Editor */}
          <div className="space-y-3 max-h-[52vh] overflow-y-auto pr-1">
            {questions.map((q, idx) => (
              <div
                key={`${q.id}-${idx}`}
                className={`bg-slate-950/90 border p-4 rounded-2xl space-y-3 ${
                  q.needsReview || (q.type === 'multiple_choice' && !q.correctAnswer)
                    ? 'border-amber-500/70'
                    : 'border-slate-800'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-amber-600 text-white font-bold text-xs flex items-center justify-center">
                      #{q.number}
                    </span>
                    <select
                      value={q.type}
                      onChange={(e) => {
                        const newType = e.target.value as Question['type'];
                        handleUpdateQuestion(idx, {
                          type: newType,
                          options:
                            newType === 'multiple_choice'
                              ? q.options && q.options.length > 0
                                ? q.options
                                : [
                                    { id: 'A', text: '' },
                                    { id: 'B', text: '' },
                                    { id: 'C', text: '' },
                                    { id: 'D', text: '' },
                                  ]
                              : q.options,
                        });
                      }}
                      className="bg-slate-900 border border-slate-700 px-2.5 py-1 rounded-lg text-xs font-semibold text-amber-300"
                    >
                      <option value="multiple_choice">Pilihan Ganda</option>
                      <option value="short_answer">Isian Singkat</option>
                      <option value="essay">Esai</option>
                    </select>

                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={1}
                        value={q.points}
                        onChange={(e) =>
                          handleUpdateQuestion(idx, {
                            points: Math.max(1, parseInt(e.target.value, 10) || 10),
                          })
                        }
                        className="w-16 bg-slate-900 border border-slate-700 px-2 py-1 rounded-lg text-xs text-white text-center"
                      />
                      <span className="text-[11px] text-slate-400">Poin</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleUpdateQuestion(idx, { needsReview: !q.needsReview })}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer ${
                        q.needsReview
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      <Flag className="w-3 h-3" />
                      <span>{q.needsReview ? 'Perlu Cek' : 'Terverifikasi'}</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleMoveQuestion(idx, -1)}
                      disabled={idx === 0}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 cursor-pointer"
                      title="Naikkan Urutan"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveQuestion(idx, 1)}
                      disabled={idx === questions.length - 1}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 cursor-pointer"
                      title="Turunkan Urutan"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteQuestion(idx)}
                      className="p-1.5 text-red-400 hover:bg-red-950 rounded-lg transition-colors cursor-pointer"
                      title="Hapus Soal"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Optional Special Instructions */}
                <div>
                  <input
                    type="text"
                    value={q.instructions || ''}
                    onChange={(e) => handleUpdateQuestion(idx, { instructions: e.target.value })}
                    placeholder="Instruksi khusus soal (opsional, biarkan kosong jika tidak ada)"
                    className="w-full bg-slate-900/70 border border-slate-800 rounded-xl px-3 py-1.5 text-[11px] text-amber-200 placeholder-slate-500 focus:outline-none focus:border-amber-400"
                  />
                </div>

                {/* Question Prompt */}
                <textarea
                  value={q.prompt}
                  onChange={(e) => handleUpdateQuestion(idx, { prompt: e.target.value })}
                  rows={2}
                  placeholder="Tuliskan teks pertanyaan..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-amber-400"
                />

                {/* Multiple Choice Options & Key */}
                {q.type === 'multiple_choice' && (
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>Opsi Jawaban:</span>
                      <span>
                        Kunci:{' '}
                        <strong className={q.correctAnswer ? 'text-emerald-400' : 'text-amber-300'}>
                          {q.correctAnswer || 'Belum ditentukan'}
                        </strong>
                        {q.correctAnswer && (
                          <button
                            type="button"
                            onClick={() => handleUpdateQuestion(idx, { correctAnswer: undefined })}
                            className="ml-2 text-slate-400 hover:text-white underline cursor-pointer"
                          >
                            Kosongkan Kunci
                          </button>
                        )}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {(q.options || []).map((opt, oIdx) => (
                        <div
                          key={opt.id}
                          className="flex items-center gap-2 bg-slate-900 p-2 rounded-xl border border-slate-800"
                        >
                          <span className="font-bold text-amber-400">{opt.id}.</span>
                          <input
                            type="text"
                            value={opt.text}
                            onChange={(e) => {
                              const newOpts = [...(q.options || [])];
                              newOpts[oIdx] = { ...newOpts[oIdx], text: e.target.value };
                              handleUpdateQuestion(idx, { options: newOpts });
                            }}
                            placeholder={`Isi pilihan ${opt.id}`}
                            className="flex-1 bg-transparent border-none text-xs text-slate-200 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdateQuestion(idx, {
                                correctAnswer: q.correctAnswer === opt.id ? undefined : opt.id,
                                needsReview: false,
                              })
                            }
                            className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                              q.correctAnswer === opt.id
                                ? 'bg-emerald-600 text-white'
                                : 'bg-slate-800 text-slate-400 hover:text-white'
                            }`}
                          >
                            {q.correctAnswer === opt.id ? 'Kunci ✓' : 'Set Kunci'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Short Answer Keywords */}
                {q.type === 'short_answer' && (
                  <div className="text-xs">
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Kata Kunci Penilaian Otomatis (pisahkan koma; kosongkan jika ingin dinilai manual):
                    </label>
                    <input
                      type="text"
                      value={(q.keywords || []).join(', ')}
                      onChange={(e) => {
                        const kws = e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean);
                        handleUpdateQuestion(idx, { keywords: kws.length > 0 ? kws : undefined });
                      }}
                      placeholder="Contoh: jakarta, dki jakarta"
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white"
                    />
                  </div>
                )}

                {/* Essay Rubric */}
                {q.type === 'essay' && (
                  <div className="text-xs">
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Rubrik Penilaian Guru (Opsional):
                    </label>
                    <input
                      type="text"
                      value={q.essayRubric || ''}
                      onChange={(e) => handleUpdateQuestion(idx, { essayRubric: e.target.value })}
                      placeholder="Kriteria kelengkapan jawaban esai..."
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Add Question & Save Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={handleAddEmptyQuestion}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Tambah Soal</span>
            </button>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={isSaving || questions.length === 0}
                onClick={() => void handlePersistPackage(false)}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer border border-slate-600"
              >
                <Save className="w-4 h-4 text-amber-300" />
                <span>{isSaving ? 'Menyimpan...' : 'Simpan Draf'}</span>
              </button>

              <button
                type="button"
                disabled={isSaving || questions.length === 0}
                onClick={() => void handlePersistPackage(true)}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-lg flex items-center gap-2 cursor-pointer"
              >
                <Rocket className="w-4 h-4" />
                <span>
                  {isSaving
                    ? 'Menerbitkan...'
                    : `Publikasikan ke Game 3D (${questions.length} Peti)`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
