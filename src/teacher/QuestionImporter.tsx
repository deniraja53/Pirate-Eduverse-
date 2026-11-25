/**
 * Unified 3-Method Question Importer (PDF <= 2MB, Word .docx/.doc <= 2MB, Google Drive + Picker)
 * Strict V11 Flow: IMPOR -> EKSTRAKSI -> RINGKASAN -> SIMPAN DRAF -> PRATINJAU & EDIT
 * Never auto-publishes imported questions directly into the live 3D game.
 * Created by Deni Raja99
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Link2,
  LogOut,
  Plus,
  RefreshCw,
  Save,
  ScanText,
  Upload,
  XCircle,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import {
  ALL_QUESTION_TYPES,
  getQuestionTypeLabel,
  type ImportExtractionResult,
  type Question,
  type QuestionPackage,
} from '../types/game';
import { CHEST_PRESETS } from '../services/storage';
import {
  importFromGoogleDriveApi,
  saveTeacherPackageApi,
  uploadDocumentWithProgress,
} from '../services/apiClient';
import {
  getCachedDriveAccessToken,
  getGoogleDriveConfigStatus,
  initGoogleDriveAuth,
  openGoogleDrivePicker,
  signInGoogleDrive,
  signOutGoogleDrive,
} from '../services/googleDriveAuth';
import { sounds } from '../services/audio';

const MAX_DOC_BYTES = 2 * 1024 * 1024; // 2,097,152 bytes

export type ImportMethodTab = 'pdf' | 'word' | 'drive';

interface QuestionImporterProps {
  onDraftReadyForEditor: (pkg: QuestionPackage, summaryText: string) => void;
  onCreateBlankManual: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const QuestionImporter: React.FC<QuestionImporterProps> = ({
  onDraftReadyForEditor,
  onCreateBlankManual,
}) => {
  const [method, setMethod] = useState<ImportMethodTab>('pdf');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const lockRef = useRef(false);

  // Local upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRunningOcr, setIsRunningOcr] = useState(false);
  const [progressPct, setProgressPct] = useState(0);

  // Google Drive / Picker state
  const driveConfig = getGoogleDriveConfigStatus();
  const [driveUser, setDriveUser] = useState<User | null>(null);
  const [driveToken, setDriveToken] = useState<string | null>(() => getCachedDriveAccessToken());
  const [isSigningDrive, setIsSigningDrive] = useState(false);
  const [driveUrlInput, setDriveUrlInput] = useState('');

  // Extraction result & summary
  const [result, setResult] = useState<ImportExtractionResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftGrade, setDraftGrade] = useState('Kelas 5 SD');
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const draftClientRequestIdRef = useRef<string>('');

  useEffect(() => {
    const unsubscribe = initGoogleDriveAuth(
      (user, token) => {
        setDriveUser(user);
        setDriveToken(token);
      },
      () => {
        setDriveUser(null);
        setDriveToken(null);
      }
    );
    return unsubscribe;
  }, []);

  const resetLocalMessages = () => {
    setErrorMsg('');
    setStatusMsg('');
    setResult(null);
    draftClientRequestIdRef.current = '';
  };

  const applyExtractionSuccess = (res: ImportExtractionResult) => {
    const safeFileName = res.fileName || selectedFile?.name || 'dokumen-soal';
    const normalizedRes: ImportExtractionResult = {
      ...res,
      fileName: safeFileName,
      questions: Array.isArray(res.questions) ? res.questions : [],
      warnings: Array.isArray(res.warnings) ? res.warnings : [],
    };
    setResult(normalizedRes);
    draftClientRequestIdRef.current = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const cleanedTitle = safeFileName
      .replace(/\.(pdf|docx|doc)$/i, '')
      .replace(/[_-]+/g, ' ')
      .trim();
    setDraftTitle(cleanedTitle || 'Paket Soal Impor Baru');

    if (normalizedRes.isScanned) {
      setStatusMsg(normalizedRes.message);
    } else if (normalizedRes.questions.length > 0) {
      setStatusMsg(normalizedRes.message);
      sounds.playCorrect();
    } else {
      setStatusMsg(normalizedRes.message);
    }
  };

  const handleFileUpload = async (file: File, expectedMethod: 'pdf' | 'word') => {
    if (lockRef.current) return;
    resetLocalMessages();

    const lowerName = file.name.toLowerCase();
    if (expectedMethod === 'pdf') {
      const isPdfMime =
        !file.type || file.type === 'application/pdf' || file.type === 'application/x-pdf';
      if (!lowerName.endsWith('.pdf') || !isPdfMime) {
        setErrorMsg(`Format file "${file.name}" tidak valid. Hanya file PDF (.pdf) yang diperbolehkan.`);
        return;
      }
    } else {
      if (!lowerName.endsWith('.docx') && !lowerName.endsWith('.doc')) {
        setErrorMsg(
          `Format file "${file.name}" tidak valid. Gunakan file Microsoft Word (.docx atau .doc).`
        );
        return;
      }
    }

    if (file.size === 0) {
      setErrorMsg('File kosong (0 byte). Silakan pilih dokumen soal yang valid.');
      return;
    }

    if (file.size > MAX_DOC_BYTES) {
      setErrorMsg(
        `Ukuran file "${file.name}" (${formatFileSize(
          file.size
        )}) melebihi batas maksimum 2 MB (2.097.152 byte). Unggahan ditolak sebelum dikirim ke server.`
      );
      return;
    }

    // Header signature check in browser before sending
    try {
      const headBuf = await file.slice(0, 8).arrayBuffer();
      const headBytes = new Uint8Array(headBuf);
      if (expectedMethod === 'pdf') {
        const text = new TextDecoder('ascii').decode(headBuf);
        if (!text.startsWith('%PDF-')) {
          setErrorMsg(
            `File "${file.name}" bukan file PDF asli (header %PDF- tidak ditemukan).`
          );
          return;
        }
      } else if (lowerName.endsWith('.docx')) {
        const isZip = headBytes[0] === 0x50 && headBytes[1] === 0x4b;
        if (!isZip) {
          setErrorMsg(`File "${file.name}" rusak atau bukan dokumen .docx yang valid.`);
          return;
        }
      }
    } catch {
      setErrorMsg('Gagal membaca header file di browser.');
      return;
    }

    lockRef.current = true;
    setSelectedFile(file);
    setIsProcessing(true);
    setProgressPct(0);

    try {
      const endpoint =
        expectedMethod === 'pdf' ? '/api/teacher/pdf/upload' : '/api/teacher/word/upload';
      const uploadReqId = `upl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const extracted = await uploadDocumentWithProgress(
        file,
        endpoint,
        (pct) => setProgressPct(pct),
        (abortFn) => {
          abortRef.current = abortFn;
        },
        uploadReqId
      );
      applyExtractionSuccess(extracted);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal mengekstrak dokumen soal.');
      sounds.playWrong();
    } finally {
      lockRef.current = false;
      abortRef.current = null;
      setIsProcessing(false);
    }
  };

  const handleRunOcr = async () => {
    if (!selectedFile || lockRef.current) return;
    lockRef.current = true;
    setIsRunningOcr(true);
    setErrorMsg('');
    setStatusMsg('Menjalankan OCR PDF di server...');
    setProgressPct(0);

    try {
      const ocrRes = await uploadDocumentWithProgress(
        selectedFile,
        '/api/teacher/pdf/ocr',
        (pct) => setProgressPct(pct),
        (abortFn) => {
          abortRef.current = abortFn;
        }
      );
      applyExtractionSuccess(ocrRes);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menjalankan OCR PDF.');
      sounds.playWrong();
    } finally {
      lockRef.current = false;
      abortRef.current = null;
      setIsRunningOcr(false);
    }
  };

  const handleCancelUpload = () => {
    abortRef.current?.();
    setIsProcessing(false);
    setProgressPct(0);
    lockRef.current = false;
  };

  const handleGoogleSignIn = async () => {
    if (isSigningDrive) return;
    setErrorMsg('');
    setIsSigningDrive(true);
    try {
      const res = await signInGoogleDrive();
      setDriveUser(res.user);
      setDriveToken(res.accessToken);
      sounds.playClick();
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Gagal menghubungkan akun Google Drive. Pastikan pop-up diizinkan di browser.'
      );
      sounds.playWrong();
    } finally {
      setIsSigningDrive(false);
    }
  };

  const handleGoogleSignOut = async () => {
    await signOutGoogleDrive();
    setDriveUser(null);
    setDriveToken(null);
    sounds.playClick();
  };

  const handleOpenPicker = async () => {
    if (!driveToken || lockRef.current) return;
    resetLocalMessages();
    try {
      const picked = await openGoogleDrivePicker(driveToken);
      if (!picked) return;
      if (picked.sizeBytes && picked.sizeBytes > MAX_DOC_BYTES) {
        setErrorMsg(
          `File "${picked.name}" (${formatFileSize(picked.sizeBytes)}) di Google Drive melebihi batas maksimum 2 MB.`
        );
        return;
      }
      setDriveUrlInput(picked.id);
      await handleImportDriveSource(picked.id, driveToken);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Gagal membuka Google Picker.'
      );
      sounds.playWrong();
    }
  };

  const handleImportDriveSource = async (fileIdOrUrl: string, tokenOverride?: string) => {
    if (lockRef.current) return;
    const cleanInput = fileIdOrUrl.trim();
    if (!cleanInput) {
      setErrorMsg('Masukkan tautan atau ID file Google Drive terlebih dahulu.');
      return;
    }

    lockRef.current = true;
    resetLocalMessages();
    setIsProcessing(true);
    setStatusMsg('Mengunduh & mengekstrak dokumen dari Google Drive...');

    try {
      const extracted = await importFromGoogleDriveApi({
        fileIdOrUrl: cleanInput,
        driveAccessToken: tokenOverride ?? driveToken ?? undefined,
      });
      applyExtractionSuccess(extracted);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Gagal mengimpor file dari Google Drive.'
      );
      sounds.playWrong();
    } finally {
      lockRef.current = false;
      setIsProcessing(false);
    }
  };

  const handleSaveAsDraftAndEdit = async () => {
    if (!result || isSavingDraft) return;
    setIsSavingDraft(true);
    setErrorMsg('');

    try {
      const starterQuestions: Question[] =
        result.questions.length > 0
          ? result.questions
          : [
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
                points: 10,
                isActive: true,
                needsReview: true,
                chestPosition: CHEST_PRESETS[0],
                locationName: CHEST_PRESETS[0].name,
              },
            ];

      if (!draftClientRequestIdRef.current) {
        draftClientRequestIdRef.current = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      }

      const saveRes = await saveTeacherPackageApi({
        title: draftTitle.trim() || `Draf Impor ${result.fileName}`,
        description: `Diimpor dari ${result.sourceMethod.toUpperCase()} (${result.fileName}) — wajib pratinjau & validasi sebelum diterbitkan.`,
        gradeLevel: draftGrade,
        isSequential: false,
        showInstantFeedback: true,
        sourceType: result.sourceMethod,
        sourceFileName: result.fileName,
        sourceFileSizeBytes: result.fileSizeBytes,
        sourcePdfName: result.sourceMethod === 'pdf' ? result.fileName : undefined,
        sourcePdfSizeBytes: result.sourceMethod === 'pdf' ? result.fileSizeBytes : undefined,
        clientRequestId: draftClientRequestIdRef.current,
        questions: starterQuestions,
      });

      if (!saveRes.success || !saveRes.package) {
        setErrorMsg(saveRes.message || 'Gagal menyimpan draf paket soal.');
        sounds.playWrong();
        return;
      }

      sounds.playCorrect();
      onDraftReadyForEditor(
        saveRes.package,
        `Draf "${saveRes.package.title}" dibuat (${saveRes.package.questions.length} soal). Silakan pratinjau, tambah gambar jika perlu, lalu simpan & terbitkan.`
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Terjadi kesalahan jaringan saat menyimpan draf paket soal.'
      );
      sounds.playWrong();
    } finally {
      setIsSavingDraft(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header Card */}
      <div className="px-card p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-[#facc15]">
            IMPOR SOAL KE DRAF BANK SOAL
          </h2>
          <p className="text-xs text-[#cbb7eb] mt-1">
            Alur aman: Impor dokumen (maks 2 MB) &rarr; Ekstraksi soal &rarr; Simpan Draf &rarr;{' '}
            <strong className="text-[#f472b6]">Pratinjau &amp; Edit Manual</strong> sebelum terbit ke game 3D.
          </p>
        </div>

        <button
          type="button"
          onClick={onCreateBlankManual}
          className="px-btn px-btn-pink px-4 py-2 text-xs flex items-center gap-1.5 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Buat Soal Manual Baru</span>
        </button>
      </div>

      {/* 3 Import Methods Selector */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button
          type="button"
          onClick={() => {
            setMethod('pdf');
            resetLocalMessages();
          }}
          className={`px-btn p-4 text-left cursor-pointer flex items-start gap-3 ${
            method === 'pdf' ? 'px-btn-purple border-[#facc15]' : 'px-btn-dark'
          }`}
        >
          <FileText className="w-6 h-6 text-[#facc15] shrink-0 mt-0.5" />
          <div>
            <div className="px-font-display text-xs text-[#facc15]">1. UNGGAH PDF</div>
            <div className="text-[11px] font-normal text-[#f8f4ff] mt-0.5">
              PDF teks atau PDF pindaian (OCR), maks 2 MB
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setMethod('word');
            resetLocalMessages();
          }}
          className={`px-btn p-4 text-left cursor-pointer flex items-start gap-3 ${
            method === 'word' ? 'px-btn-purple border-[#facc15]' : 'px-btn-dark'
          }`}
        >
          <FileSpreadsheet className="w-6 h-6 text-[#f472b6] shrink-0 mt-0.5" />
          <div>
            <div className="px-font-display text-xs text-[#f472b6]">2. WORD (.DOCX / .DOC)</div>
            <div className="text-[11px] font-normal text-[#f8f4ff] mt-0.5">
              Dokumen Microsoft Word terstruktur, maks 2 MB
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setMethod('drive');
            resetLocalMessages();
          }}
          className={`px-btn p-4 text-left cursor-pointer flex items-start gap-3 ${
            method === 'drive' ? 'px-btn-purple border-[#facc15]' : 'px-btn-dark'
          }`}
        >
          <Cloud className="w-6 h-6 text-[#facc15] shrink-0 mt-0.5" />
          <div>
            <div className="px-font-display text-xs text-[#facc15]">3. GOOGLE DRIVE</div>
            <div className="text-[11px] font-normal text-[#f8f4ff] mt-0.5">
              Google Picker atau tautan Google Drive / Docs
            </div>
          </div>
        </button>
      </div>

      {/* METHOD A / B: PDF OR WORD UPLOAD */}
      {(method === 'pdf' || method === 'word') && (
        <div className="px-card p-5 space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingOver(true);
            }}
            onDragLeave={() => setIsDraggingOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggingOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) void handleFileUpload(f, method);
            }}
            className={`border-2 border-dashed p-6 sm:p-8 text-center transition-colors ${
              isDraggingOver
                ? 'border-[#facc15] bg-[#3b1f69]'
                : 'border-[#a855f7] bg-[#140924]'
            }`}
          >
            <Upload className="w-10 h-10 text-[#facc15] mx-auto mb-2.5" />
            <div className="font-bold text-sm text-[#f8f4ff]">
              {method === 'pdf'
                ? 'Seret & Lepas File PDF Soal ke Sini'
                : 'Seret & Lepas File Microsoft Word (.docx / .doc) ke Sini'}
            </div>
            <p className="text-xs text-[#cbb7eb] mt-1 mb-4">
              {method === 'pdf' ? (
                <>
                  Format: <strong className="text-[#facc15]">.pdf</strong> • Batas ukuran:{' '}
                  <strong className="text-[#facc15]">2 MB (2.097.152 byte)</strong>
                </>
              ) : (
                <>
                  Format utama: <strong className="text-[#f472b6]">.docx</strong> (juga mendeteksi .doc) • Batas ukuran:{' '}
                  <strong className="text-[#facc15]">2 MB</strong>
                </>
              )}
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept={method === 'pdf' ? 'application/pdf,.pdf' : '.docx,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword'}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void handleFileUpload(f, method);
              }}
              disabled={isProcessing || isRunningOcr}
              className="hidden"
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing || isRunningOcr}
              className="px-btn px-btn-gold px-5 py-2.5 text-xs inline-flex items-center gap-2 cursor-pointer"
            >
              <FolderOpen className="w-4 h-4" />
              <span>
                {isProcessing
                  ? 'Mengunggah & Mengekstrak...'
                  : method === 'pdf'
                  ? 'Pilih File PDF (≤ 2 MB)'
                  : 'Pilih File Word (≤ 2 MB)'}
              </span>
            </button>
          </div>

          {selectedFile && (
            <div className="px-subcard p-3.5 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-[#facc15] truncate">{selectedFile.name}</div>
                  <div className="text-[11px] text-[#cbb7eb]">
                    Ukuran: <strong>{formatFileSize(selectedFile.size)}</strong> (
                    {selectedFile.size.toLocaleString('id-ID')} byte)
                    {result?.pageCount ? ` • ${result.pageCount} halaman` : ''}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {isProcessing ? (
                    <button
                      type="button"
                      onClick={handleCancelUpload}
                      className="px-btn px-btn-red px-3 py-1.5 text-xs flex items-center gap-1 cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Batalkan</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-btn px-btn-dark px-3 py-1.5 text-xs flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Ganti File</span>
                    </button>
                  )}
                </div>
              </div>

              {(isProcessing || isRunningOcr || progressPct > 0) && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-[#cbb7eb]">
                    <span>
                      {isRunningOcr
                        ? 'Menjalankan OCR PDF di server...'
                        : isProcessing
                        ? 'Mengunggah & mengekstrak soal...'
                        : 'Proses selesai'}
                    </span>
                    <span className="font-mono font-bold text-[#facc15]">{progressPct}%</span>
                  </div>
                  <div className="w-full h-2.5 bg-[#090312] border border-[#6d28d9]">
                    <div
                      className="h-full bg-[#facc15] transition-all duration-200"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* METHOD C: GOOGLE DRIVE + GOOGLE PICKER */}
      {method === 'drive' && (
        <div className="px-card p-5 space-y-4">
          <div className="px-subcard p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-[#facc15]">Status Koneksi Google Drive:</span>
                {!driveConfig.configured ? (
                  <span className="px-badge bg-amber-950 border-[#facc15] text-[#facc15]">
                    Konfigurasi OAuth Belum Tersedia
                  </span>
                ) : driveToken && driveUser ? (
                  <span className="px-badge bg-emerald-950 border-[#22c55e] text-emerald-300">
                    <CheckCircle2 className="w-3 h-3" />
                    Terhubung: {driveUser.email || driveUser.displayName || 'Akun Google'}
                  </span>
                ) : (
                  <span className="px-badge bg-[#281647] border-[#f472b6] text-[#f472b6]">
                    Siap Dihubungkan • Silakan Masuk Akun Google
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[#cbb7eb]">
                Dengan izin minimal per file (Google Picker), Pirate Academy hanya membaca file soal yang Anda pilih sendiri (PDF, Word .docx/.doc, atau Google Docs, maks 2 MB) — tidak mengakses seluruh isi Google Drive Anda.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {driveConfig.configured && (!driveToken || !driveUser) && (
                <button
                  type="button"
                  onClick={() => void handleGoogleSignIn()}
                  disabled={isSigningDrive}
                  className="bg-white hover:bg-slate-100 text-slate-900 font-bold text-xs px-4 py-2 border-2 border-[#0a0414] shadow-[3px_3px_0px_#0a0414] flex items-center gap-2 cursor-pointer"
                >
                  <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                  </svg>
                  <span>{isSigningDrive ? 'Menghubungkan...' : 'Masuk dengan Google'}</span>
                </button>
              )}

              {driveToken && driveUser && (
                <>
                  <button
                    type="button"
                    onClick={() => void handleOpenPicker()}
                    disabled={isProcessing}
                    className="px-btn px-btn-gold px-4 py-2 text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <FolderOpen className="w-4 h-4" />
                    <span>Pilih File via Google Picker</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleGoogleSignOut()}
                    className="px-btn px-btn-dark px-3 py-2 text-xs flex items-center gap-1 cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Keluar Drive</span>
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-bold text-[#facc15]">
              Atau Tempel Tautan / ID File Google Drive atau Google Docs:
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Link2 className="w-4 h-4 text-[#cbb7eb] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={driveUrlInput}
                  onChange={(e) => setDriveUrlInput(e.target.value)}
                  placeholder="https://drive.google.com/file/d/... atau https://docs.google.com/document/d/..."
                  className="px-input w-full pl-9 pr-3 py-2 text-xs"
                />
              </div>
              <button
                type="button"
                disabled={isProcessing || !driveUrlInput.trim()}
                onClick={() => void handleImportDriveSource(driveUrlInput)}
                className="px-btn px-btn-pink px-5 py-2 text-xs cursor-pointer shrink-0"
              >
                {isProcessing ? 'Mengimpor...' : 'Impor dari Tautan Drive'}
              </button>
            </div>
            <p className="text-[11px] text-[#cbb7eb]">
              Catatan: Untuk file privat, gunakan tombol <strong>Pilih File via Google Picker</strong> di atas agar aplikasi hanya mengakses file yang dipilih. Kolom tautan hanya berlaku untuk tautan publik (&quot;Anyone with the link&quot;) atau file yang sudah dipilih via Picker.
            </p>
          </div>
        </div>
      )}

      {/* Scanned PDF explicit OCR prompt */}
      {result?.isScanned && (
        <div className="px-card-pink p-4 space-y-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-[#facc15] shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <div className="font-bold text-[#facc15] text-sm">
                PDF Pindaian (Scan Gambar) Terdeteksi — Tidak Ada Lapisan Teks
              </div>
              <p className="text-[#f8f4ff]">{result.message}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {result.ocrAvailable && selectedFile ? (
              <button
                type="button"
                onClick={() => void handleRunOcr()}
                disabled={isRunningOcr}
                className="px-btn px-btn-gold px-4 py-2 text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <ScanText className="w-4 h-4" />
                <span>{isRunningOcr ? 'Memproses OCR...' : 'Jalankan Ekstraksi OCR Server'}</span>
              </button>
            ) : (
              <span className="text-[11px] text-[#facc15] px-subcard px-3 py-1.5">
                Layanan OCR otomatis belum aktif di server. Gunakan PDF berbasis teks, Word (.docx), atau editor manual.
              </span>
            )}
          </div>
        </div>
      )}

      {/* Honest Error Banner */}
      {errorMsg && (
        <div className="px-card border-[#ef4444] bg-red-950/90 p-3.5 text-red-100 text-xs flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-[#ef4444] shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Extraction Summary & Hand-off to Editor/Preview (Never Auto-Published!) */}
      {result && !result.isScanned && (
        <div className="px-card-gold p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#6d28d9] pb-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-[#22c55e] font-bold text-sm">
                <CheckCircle2 className="w-5 h-5 shrink-0" />
                <span>RINGKASAN HASIL EKSTRAKSI DOKUMEN</span>
              </div>
              <p className="text-xs text-[#f8f4ff]">{statusMsg || result.message}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="px-badge bg-[#140924] border-[#facc15] text-[#facc15]">
                {result.summary?.totalExtracted ?? result.recognizedCount} Total Soal
              </span>
              <span className="px-badge bg-emerald-950 border-[#22c55e] text-emerald-300">
                {result.summary?.matchedKeysCount ??
                  result.questions.filter((q) => q.answerStatus === 'verified' && q.type !== 'essay').length}{' '}
                Kunci Cocok Otomatis
              </span>
              {result.needsReviewCount > 0 && (
                <span className="px-badge bg-amber-950 border-[#f472b6] text-[#f472b6]">
                  {result.needsReviewCount} Perlu Cek Manual
                </span>
              )}
              {(result.summary?.blockingErrorCount ?? 0) > 0 && (
                <span className="px-badge bg-red-950 border-[#ef4444] text-red-300">
                  {result.summary!.blockingErrorCount} Error Validasi
                </span>
              )}
              {typeof result.embeddedImageCount === 'number' && result.embeddedImageCount > 0 && (
                <span className="px-badge bg-[#140924] border-[#a855f7] text-[#cbb7eb]">
                  {result.embeddedImageCount} Gambar Terdeteksi di Word
                </span>
              )}
            </div>
          </div>

          {/* 6-Type Breakdown Grid */}
          {result.summary && result.questions.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-[11px]">
              {ALL_QUESTION_TYPES.map((qType) => {
                const count = result.summary?.byType?.[qType] ?? 0;
                return (
                  <div
                    key={qType}
                    className={`px-subcard px-2.5 py-2 flex items-center justify-between gap-1.5 ${
                      count > 0 ? 'border-[#a855f7]' : 'opacity-60'
                    }`}
                  >
                    <span className="text-[#cbb7eb] truncate">{getQuestionTypeLabel(qType)}</span>
                    <span className="font-bold text-[#facc15] tabular-nums">{count}</span>
                  </div>
                );
              })}
            </div>
          )}

          {result.warnings.length > 0 && (
            <div className="px-subcard p-3 space-y-1 text-[11px] text-[#facc15]">
              <div className="font-bold">Catatan &amp; Peringatan Ekstraksi:</div>
              {result.warnings.map((w, i) => (
                <div key={i}>• {w}</div>
              ))}
            </div>
          )}

          {/* Quick Draft Metadata before opening Editor */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block font-bold text-[#facc15] mb-1">Nama Draf Paket Soal:</label>
              <input
                type="text"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="Contoh: Latihan IPAS Bab 3"
                className="px-input w-full px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block font-bold text-[#facc15] mb-1">Jenjang / Kelas:</label>
              <select
                value={draftGrade}
                onChange={(e) => setDraftGrade(e.target.value)}
                className="px-input w-full px-3 py-2 text-xs"
              >
                <option value="Kelas 4 SD">Kelas IV (4) SD</option>
                <option value="Kelas 5 SD">Kelas V (5) SD</option>
                <option value="Kelas 6 SD">Kelas VI (6) SD</option>
                <option value="Kelas 4 - 6 SD">Kelas 4 - 6 SD</option>
              </select>
            </div>
          </div>

          {/* Mini Preview of Extracted Questions */}
          {result.questions.length > 0 && (
            <div className="px-subcard p-3 space-y-2 max-h-60 overflow-y-auto">
              <div className="text-[11px] font-bold text-[#cbb7eb]">
                Pratinjau Soal Terdeteksi (klik tombol di bawah untuk mengedit lengkap &amp; menambah gambar):
              </div>
              {result.questions.slice(0, 8).map((q) => {
                const keySummary =
                  q.type === 'multiple_choice'
                    ? q.correctAnswer || 'Kunci kosong'
                    : q.type === 'multiple_choice_complex'
                    ? q.correctAnswers?.join(', ') || 'Kunci kosong'
                    : q.type === 'true_false'
                    ? typeof q.correctBoolean === 'boolean'
                      ? q.correctBoolean
                        ? 'Benar'
                        : 'Salah'
                      : 'Kunci kosong'
                    : q.type === 'matching'
                    ? `${q.matchingPairs?.length || 0} pasangan`
                    : q.type === 'short_answer'
                    ? (q.acceptedAnswers || q.keywords || []).join(' / ') || 'Kunci kosong'
                    : q.essayRubric
                    ? 'Ada Rubrik'
                    : 'Manual Guru';

                const srcLabel =
                  q.answerSource === 'pdf_inline_key'
                    ? 'Inline PDF'
                    : q.answerSource === 'pdf_answer_key'
                    ? 'Kunci PDF'
                    : q.answerSource === 'word_answer_key'
                    ? 'Kunci Word'
                    : q.answerSource === 'ocr_answer_key'
                    ? 'OCR'
                    : q.answerSource === 'drive_answer_key'
                    ? 'Drive'
                    : null;

                return (
                  <div
                    key={q.id}
                    className={`p-2 bg-[#1c0f33] border text-xs flex items-start justify-between gap-2 ${
                      q.needsReview ? 'border-[#f472b6]' : 'border-[#4c1d95]'
                    }`}
                  >
                    <div className="min-w-0">
                      <span className="font-bold text-[#facc15] mr-1.5">#{q.number}</span>
                      {q.questionNumber && q.questionNumber !== q.number && (
                        <span className="text-[10px] text-[#cbb7eb] mr-1.5">
                          (No. Dok #{q.questionNumber})
                        </span>
                      )}
                      <span className="text-[#f8f4ff]">{q.prompt}</span>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1 text-[10px]">
                      <span className="text-[#f472b6] font-bold">
                        {getQuestionTypeLabel(q.type)} • {keySummary}
                      </span>
                      <div className="flex items-center gap-1">
                        {srcLabel && (
                          <span className="px-1.5 py-0.5 bg-emerald-950 border border-[#22c55e] text-emerald-300">
                            {srcLabel}
                          </span>
                        )}
                        {q.needsReview && (
                          <span className="px-1.5 py-0.5 bg-amber-950 border border-[#facc15] text-[#facc15] font-bold">
                            NEEDS_REVIEW
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {result.questions.length > 8 && (
                <div className="text-[11px] text-[#cbb7eb] italic">
                  ...dan {result.questions.length - 8} soal lainnya.
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <span className="text-[11px] text-[#cbb7eb]">
              Status awal: <strong className="text-[#facc15]">Draf</strong> (belum tayang ke siswa hingga Anda menyinkronkannya).
            </span>
            <button
              type="button"
              disabled={isSavingDraft}
              onClick={() => void handleSaveAsDraftAndEdit()}
              className="px-btn px-btn-gold px-5 py-2.5 text-xs flex items-center gap-2 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>
                {isSavingDraft
                  ? 'Menyimpan Draf...'
                  : 'Simpan ke Draf & Buka Editor Pratinjau'}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
