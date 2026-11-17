/**
 * ResultScreen Component for Pirate Academy: Treasure Quest (V4)
 * Shows authoritative score summary, honest Google Sheets sync status with retry,
 * and printable Pirate Certificate.
 * Created by Deni Raja99
 */

import React, { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import {
  Award,
  Coins,
  CheckCircle2,
  Clock,
  Printer,
  RotateCcw,
  Home,
  Compass,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import type { StudentSession, QuestionPackage } from '../types/game';
import { sounds } from '../services/audio';
import { syncSessionToGoogleSheets } from '../services/sheetsApi';
import { saveStudentSession } from '../services/storage';

interface ResultScreenProps {
  session: StudentSession;
  questionPackage: QuestionPackage;
  onSessionUpdated?: (session: StudentSession) => void;
  onPlayAgain: () => void;
  onExitToMenu: () => void;
}

export const ResultScreen: React.FC<ResultScreenProps> = ({
  session,
  questionPackage,
  onSessionUpdated,
  onPlayAgain,
  onExitToMenu,
}) => {
  const [isSyncing, setIsSyncing] = useState(session.sheetsSyncStatus === 'syncing');
  const [syncMessage, setSyncMessage] = useState<string>(session.sheetsSyncError || '');

  useEffect(() => {
    sounds.playVictory();
    try {
      confetti({
        particleCount: 80,
        spread: 90,
        origin: { y: 0.5 },
        colors: ['#f59e0b', '#10b981', '#3b82f6', '#ec4899', '#ffffff'],
      });
    } catch {}
  }, []);

  const handleSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setSyncMessage('Mengirim hasil petualangan ke Google Sheets melalui server...');
    const res = await syncSessionToGoogleSheets(session);
    setIsSyncing(false);
    setSyncMessage(res.message);

    if (res.session) {
      saveStudentSession(res.session);
      onSessionUpdated?.(res.session);
    }
  };

  const handlePrintCertificate = () => {
    sounds.playClick();
    window.print();
  };

  const formattedDate = new Date(session.startTime).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const answerValues = Object.values(session.answers || {});
  const correctCount = answerValues.filter((a) => a.isCorrect === true).length;
  const wrongCount = answerValues.filter((a) => a.isCorrect === false).length;
  const pendingCount = answerValues.filter(
    (a) => a.gradingStatus === 'pending_review' && !a.isGradedManually
  ).length;

  const syncStatus = isSyncing
    ? 'syncing'
    : session.sheetsSyncStatus || (session.syncedToSheets ? 'synced' : 'idle');

  return (
    <div className="relative w-full h-full min-h-screen bg-slate-950 text-white p-4 sm:p-8 overflow-y-auto select-none">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Celebration Header */}
        <div className="text-center pt-4">
          <div className="inline-flex p-3 rounded-full bg-amber-500/20 border-2 border-amber-400 text-amber-400 mb-3 animate-bounce">
            <Award className="w-12 h-12" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold font-pirate text-amber-400 tracking-wider">
            MISI SELESAI, PETUALANG HEBAT!
          </h1>
          <p className="text-sm sm:text-base text-amber-200/90 font-cinzel">
            Kamu berhasil menjelajahi Pulau Harta Karun dan menyelesaikan petualanganmu!
          </p>
        </div>

        {/* Score Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-slate-900/90 border border-amber-600/50 p-4 rounded-2xl text-center shadow-lg">
            <span className="text-xs text-amber-300 font-bold uppercase block mb-1">Skor Diperoleh</span>
            <div className="text-2xl sm:text-3xl font-extrabold text-amber-400 flex items-center justify-center gap-1 tabular-nums">
              <Coins className="w-6 h-6 fill-current" />
              <span>{session.totalScore}</span>
            </div>
            <span className="text-[11px] text-slate-400 tabular-nums">
              dari {session.maxPossibleScore} poin maks
            </span>
          </div>

          <div className="bg-slate-900/90 border border-emerald-600/50 p-4 rounded-2xl text-center shadow-lg">
            <span className="text-xs text-emerald-300 font-bold uppercase block mb-1">Nilai Sementara</span>
            <div className="text-2xl sm:text-3xl font-extrabold text-emerald-400 tabular-nums">
              {session.percentageScore}%
            </div>
            <span className="text-[11px] text-slate-400">
              {pendingCount > 0
                ? `${pendingCount} soal menunggu koreksi guru`
                : session.percentageScore >= 80
                ? 'Sangat Memuaskan'
                : session.percentageScore >= 60
                ? 'Lulus Baik'
                : 'Tetap Semangat'}
            </span>
          </div>

          <div className="bg-slate-900/90 border border-sky-600/50 p-4 rounded-2xl text-center shadow-lg">
            <span className="text-xs text-sky-300 font-bold uppercase block mb-1">Peti Terbuka</span>
            <div className="text-2xl sm:text-3xl font-extrabold text-sky-400 tabular-nums">
              {session.chestsCompleted.length}/{questionPackage.questions.length}
            </div>
            <span className="text-[11px] text-slate-400 tabular-nums">
              {correctCount} Benar · {wrongCount} Salah
              {pendingCount > 0 ? ` · ${pendingCount} Review` : ''}
            </span>
          </div>

          <div className="bg-slate-900/90 border border-purple-600/50 p-4 rounded-2xl text-center shadow-lg">
            <span className="text-xs text-purple-300 font-bold uppercase block mb-1">Status Sheets</span>
            <div className="text-xs font-bold mt-2 flex items-center justify-center gap-1">
              {syncStatus === 'synced' ? (
                <span className="text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4" /> Tersinkron
                </span>
              ) : syncStatus === 'syncing' ? (
                <span className="text-sky-400 flex items-center gap-1">
                  <RefreshCw className="w-4 h-4 animate-spin" /> Mengirim...
                </span>
              ) : syncStatus === 'failed' ? (
                <span className="text-red-400 flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4" /> Gagal Sinkron
                </span>
              ) : (
                <span className="text-amber-400 flex items-center gap-1">
                  <Clock className="w-4 h-4" /> Tersimpan di Server
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => void handleSync()}
              disabled={isSyncing}
              className="mt-2 text-[10px] text-amber-300 underline hover:text-white cursor-pointer disabled:opacity-50"
            >
              {isSyncing ? 'Mengirim...' : 'Kirim / Sinkron Ulang'}
            </button>
          </div>
        </div>

        {syncMessage && (
          <div
            className={`text-center text-xs py-2 px-4 rounded-xl border ${
              syncStatus === 'failed'
                ? 'bg-red-950/60 border-red-600/40 text-red-200'
                : 'bg-amber-950/60 border-amber-600/40 text-amber-300'
            }`}
          >
            {syncMessage}
          </div>
        )}

        {/* PRINTABLE DIPLOMA / CERTIFICATE CARD */}
        <div
          id="pirate-certificate"
          className="relative bg-amber-50 text-slate-900 border-8 border-amber-900/80 rounded-3xl p-6 sm:p-10 shadow-2xl overflow-hidden print:m-0 print:border-4"
          style={{
            backgroundImage: `radial-gradient(#fde68a 1px, transparent 1px)`,
            backgroundSize: '20px 20px',
          }}
        >
          <div className="border-2 border-dashed border-amber-800/60 rounded-2xl p-6 sm:p-8 text-center flex flex-col items-center justify-between">
            <div className="space-y-1">
              <div className="text-xs font-bold uppercase tracking-widest text-amber-900 font-cinzel">
                AKADEMI BAJAK LAUT NUSANTARA
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold font-pirate text-amber-950 tracking-wider">
                SERTIFIKAT KELULUSAN PETUALANG CILIK
              </h2>
              <div className="text-xs text-amber-800 font-medium">
                Pirate Academy: Treasure Quest • Edisi Petualangan Bahari
              </div>
            </div>

            <div className="my-6 space-y-2">
              <p className="text-xs text-slate-600 italic">Diberikan dengan bangga kepada:</p>
              <div className="text-2xl sm:text-3xl font-black text-amber-900 border-b-2 border-amber-800/40 pb-1 px-8 font-cinzel">
                {session.student.name}
              </div>
              <div className="text-sm font-bold text-slate-700">
                Siswa {session.student.grade}
              </div>
              <p className="text-xs text-slate-700 max-w-lg mx-auto pt-2 leading-relaxed">
                Telah berhasil menuntaskan petualangan edukasi di Pulau Bajak Laut pada paket{' '}
                <strong>"{questionPackage.title}"</strong> dengan perolehan skor{' '}
                <strong>
                  {session.totalScore} Poin ({session.percentageScore}%)
                </strong>
                .
              </p>
            </div>

            <div className="w-full flex items-end justify-between pt-4 border-t border-amber-800/30 text-xs text-slate-700">
              <div className="text-left">
                <div className="text-slate-500 text-[11px]">Tanggal Penerbitan:</div>
                <div className="font-bold text-slate-800">{formattedDate}</div>
              </div>

              <div className="w-16 h-16 rounded-full bg-amber-600 text-amber-100 border-4 border-amber-700 flex flex-col items-center justify-center font-pirate text-center shadow-md">
                <Compass className="w-5 h-5 text-amber-200" />
                <span className="text-[9px] font-bold tracking-tight">RESMI</span>
              </div>

              <div className="text-right">
                <div className="font-pirate text-base text-amber-900 font-bold">Deni Raja99</div>
                <div className="border-t border-slate-400 pt-0.5 font-semibold text-[11px]">
                  Game Developer &amp; Mentor
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2 print:hidden">
          <button
            type="button"
            onClick={handlePrintCertificate}
            className="py-3 px-6 rounded-xl bg-amber-500 hover:bg-amber-400 text-amber-950 font-bold text-xs sm:text-sm font-cinzel uppercase shadow-lg flex items-center gap-2 cursor-pointer transition-colors"
          >
            <Printer className="w-4 h-4" />
            <span>Cetak / Unduh Sertifikat</span>
          </button>

          <button
            type="button"
            onClick={() => {
              sounds.playClick();
              onPlayAgain();
            }}
            className="py-3 px-5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs sm:text-sm flex items-center gap-2 cursor-pointer transition-colors"
          >
            <RotateCcw className="w-4 h-4 text-amber-400" />
            <span>Main Lagi</span>
          </button>

          <button
            type="button"
            onClick={() => {
              sounds.playClick();
              onExitToMenu();
            }}
            className="py-3 px-5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 font-bold text-xs sm:text-sm flex items-center gap-2 cursor-pointer transition-colors"
          >
            <Home className="w-4 h-4" />
            <span>Menu Utama</span>
          </button>
        </div>
      </div>
    </div>
  );
};
