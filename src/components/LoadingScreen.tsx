/**
 * LoadingScreen Component for Pirate Academy 3D (V6)
 * Fullscreen pirate-themed transition between Biodata and 3D Gameplay.
 * Features the mandatory .loader CSS animation, genuine readiness progress,
 * zero Sparkles icons, and error/retry recovery without losing student biodata.
 * Created by Deni Raja99
 */

import React from 'react';
import { Anchor, AlertTriangle, ArrowLeft, Compass, RefreshCw } from 'lucide-react';

interface LoadingScreenProps {
  studentName: string;
  studentGrade: string;
  progressPercent: number;
  statusMessage: string;
  error?: string;
  onRetry: () => void;
  onBackToLogin: () => void;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  studentName,
  studentGrade,
  progressPercent,
  statusMessage,
  error,
  onRetry,
  onBackToLogin,
}) => {
  const clampedProgress = Math.max(0, Math.min(100, Math.round(progressPercent)));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950 text-white overflow-hidden select-none"
      role="dialog"
      aria-modal="true"
      aria-label="Memuat Dunia 3D Pirate Academy"
    >
      {/* Full-bleed Pirate Background matching Cover Artwork */}
      <img
        src="/assets/aistudio/cover_game_6bac803c.png"
        alt="Latar Ekspedisi Pirate Academy 3D"
        className="absolute inset-0 w-full h-full object-cover object-center pointer-events-none scale-105 filter brightness-50 contrast-110"
        referrerPolicy="no-referrer"
      />

      {/* Measured atmospheric dark scrim for crisp readability */}
      <div className="absolute inset-0 bg-gradient-to-b from-slate-950/80 via-slate-950/75 to-slate-950/90 backdrop-blur-sm pointer-events-none" />

      {/* Centered Clean Pirate Loading Panel */}
      <div className="relative z-10 w-full max-w-md bg-slate-950/80 border border-amber-500/40 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-black/80 backdrop-blur-md text-center space-y-5">
        {/* Pirate Compass Emblem */}
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-amber-600 via-amber-500 to-amber-300 p-0.5 mx-auto shadow-xl border border-amber-200/80">
          <div className="w-full h-full rounded-2xl bg-slate-950 flex items-center justify-center">
            <Compass className={`w-8 h-8 text-amber-400 ${error ? '' : 'animate-spin'}`} />
          </div>
        </div>

        {/* Minimal Student Metadata (unboxed typography with dot separator) */}
        <div className="space-y-1">
          <div className="text-xs font-semibold text-amber-300/90 flex items-center justify-center gap-2">
            <Anchor className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="truncate max-w-[14rem]">{studentName}</span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">{studentGrade}</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-pirate font-bold tracking-wider text-amber-300">
            Menyiapkan Pelayaran 3D
          </h2>
        </div>

        {error ? (
          <div className="space-y-4">
            <div
              className="p-4 rounded-2xl bg-red-950/85 border border-red-500/70 text-red-200 text-xs sm:text-sm leading-relaxed flex flex-col items-center gap-2"
              role="alert"
            >
              <AlertTriangle className="w-6 h-6 text-red-400 shrink-0" />
              <span className="font-semibold">{error}</span>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={onBackToLogin}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Kembali ke Biodata</span>
              </button>

              <button
                type="button"
                onClick={onRetry}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-amber-950 font-extrabold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-lg transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Coba Lagi</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Mandatory CSS Loader Animation */}
            <div className="flex justify-center py-1">
              <div
                className="loader text-amber-300 drop-shadow-[0_2px_10px_rgba(245,158,11,0.45)]"
                role="status"
                aria-live="polite"
                aria-label="Memuat permainan"
              />
            </div>

            {/* Progress Bar synced to real scene & session readiness */}
            <div className="space-y-2">
              <div className="w-full h-2.5 bg-slate-900 rounded-full border border-amber-600/40 p-0.5 overflow-hidden">
                <div
                  style={{ width: `${clampedProgress}%` }}
                  className="h-full rounded-full bg-gradient-to-r from-amber-600 via-amber-400 to-amber-300 transition-all duration-200"
                />
              </div>

              <div className="flex items-center justify-between text-xs text-slate-300 font-medium">
                <span className="truncate pr-2">{statusMessage}</span>
                <span className="font-mono tabular-nums text-amber-300 font-bold shrink-0">
                  {clampedProgress}%
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
