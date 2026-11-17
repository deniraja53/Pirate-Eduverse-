/**
 * CoverScreen Component for Pirate Academy: Treasure Hunt Eduverse
 * Full-Bleed Immersive Cover Artwork (/assets/aistudio/cover_game_6bac803c.png)
 * Features integrated bottom loading progress bar and bottom-right "Mulai" button
 * directly overlaying the cover image without any separated footer box.
 * Zero Sparkles (✨) icons as requested.
 * Created by Deni Raja99
 */

import React, { useState, useEffect } from 'react';
import { sounds } from '../services/audio';
import { Play, Anchor, Shield, Compass, Volume2, VolumeX, ChevronRight, CheckCircle2 } from 'lucide-react';

interface CoverScreenProps {
  onStart: () => void;
  onOpenTeacherDashboard?: () => void;
}

export const CoverScreen: React.FC<CoverScreenProps> = ({
  onStart,
  onOpenTeacherDashboard,
}) => {
  const [loadProgress, setLoadProgress] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [isMuted, setIsMuted] = useState(sounds.getMuted());

  // Real preloading of critical assets
  useEffect(() => {
    let mounted = true;

    const criticalImages = [
      '/assets/aistudio/cover_game_6bac803c.png',
      '/assets/aistudio/Kolase_Noir_Pria_di_Kota_Berkabut_692148ea.png',
      '/assets/aistudio/Desain_tanpa_judul__6__dff919a6.png',
    ];

    let loadedCount = 0;
    const totalAssets = criticalImages.length;

    criticalImages.forEach((src) => {
      const img = new Image();
      img.onload = () => {
        if (!mounted) return;
        loadedCount++;
        const pct = Math.round((loadedCount / totalAssets) * 85);
        setLoadProgress((prev) => Math.max(prev, pct));
      };
      img.onerror = () => {
        if (!mounted) return;
        loadedCount++;
        setLoadProgress((prev) => Math.max(prev, Math.round((loadedCount / totalAssets) * 85)));
      };
      img.src = src;
    });

    // Smooth progress animation to 100%
    const startTime = Date.now();
    const minLoadTime = 1400; // Smooth 1.4s minimum duration for visual cadence

    const ticker = setInterval(() => {
      if (!mounted) return;
      const elapsed = Date.now() - startTime;
      const timeRatio = Math.min(elapsed / minLoadTime, 1);

      setLoadProgress((prev) => {
        const next = Math.max(prev, Math.round(timeRatio * 100));
        if (next >= 100) {
          clearInterval(ticker);
          setIsReady(true);
          return 100;
        }
        return next;
      });
    }, 35);

    return () => {
      mounted = false;
      clearInterval(ticker);
    };
  }, []);

  const handleStartGame = () => {
    if (!isReady) return;
    sounds.unlockAudio();
    sounds.playClick();
    onStart();
  };

  const toggleSound = () => {
    const muted = sounds.toggleMute();
    setIsMuted(muted);
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden select-none bg-slate-950">
      {/* 
        1. FULL-BLEED IMMERSIVE COVER IMAGE
        Covers the entire screen responsively (object-cover) with centered composition.
        No separate footer box; entire visual canvas is unified.
      */}
      <img
        src="/assets/aistudio/cover_game_6bac803c.png"
        alt="Treasure Hunt Eduverse - Pirate Academy 3D"
        className="absolute inset-0 w-full h-full object-cover object-center pointer-events-none transform transition-transform duration-1000 scale-100"
      />

      {/* Subtle bottom vignette overlay for high contrast of overlays without obscuring the artwork */}
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/20 to-slate-950/20 pointer-events-none" />

      {/* TOP BAR OVERLAY: Sound toggle & Teacher portal shortcut */}
      <div className="absolute top-4 sm:top-6 left-4 sm:left-6 right-4 sm:right-6 flex items-center justify-between z-30 pointer-events-auto">
        {/* Creator Badge & Sound Toggle */}
        <div className="flex items-center gap-2">
          <div className="px-3.5 py-1.5 rounded-xl bg-slate-950/70 backdrop-blur-xs border border-amber-500/40 text-amber-300 text-xs font-bold shadow-lg flex items-center gap-2">
            <Anchor className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline text-slate-300 font-normal">Karya:</span>
            <span className="font-extrabold text-amber-400">Deni Raja99</span>
          </div>

          <button
            onClick={toggleSound}
            className="p-2 rounded-xl bg-slate-950/70 hover:bg-slate-900/90 backdrop-blur-xs border border-amber-500/40 text-amber-300 text-xs font-bold shadow-lg cursor-pointer transition-colors"
            title={isMuted ? 'Nyalakan Suara' : 'Matikan Suara'}
          >
            {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-amber-400" />}
          </button>
        </div>

        {/* Teacher Portal Button */}
        {onOpenTeacherDashboard && (
          <button
            onClick={() => {
              sounds.playClick();
              onOpenTeacherDashboard();
            }}
            className="px-3.5 py-1.5 rounded-xl bg-slate-950/75 hover:bg-slate-900 backdrop-blur-xs text-amber-300 text-xs font-bold border border-amber-500/40 shadow-xl flex items-center gap-2 cursor-pointer transition-transform hover:scale-105 active:scale-95"
            title="Masuk ke Dashboard Guru"
          >
            <Shield className="w-3.5 h-3.5 text-amber-400" />
            <span>Portal Guru</span>
          </button>
        )}
      </div>

      {/* 
        2. BOTTOM LOADING INDICATOR OVERLAY (BOTTOM-LEFT / BOTTOM-CENTER)
        Cinematic translucent progress bar directly overlaying the lower part of the cover.
        Safely spaced from the bottom edge and does NOT collide with the bottom-right Mulai button.
      */}
      <div className="absolute bottom-5 sm:bottom-7 left-4 sm:left-8 z-20 max-w-xs sm:max-w-md w-[calc(100%-170px)] sm:w-auto pointer-events-auto">
        <div className="bg-slate-950/80 backdrop-blur-md border border-amber-500/40 p-2.5 sm:p-3 rounded-2xl shadow-2xl flex flex-col gap-1.5">
          <div className="flex justify-between items-center text-[11px] sm:text-xs font-bold">
            <span className="text-amber-300 flex items-center gap-1.5 truncate">
              {isReady ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Kapal & Peta Samudra Siap!</span>
                </>
              ) : (
                <>
                  <Compass className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />
                  <span>Menyiapkan Ekspedisi 3D...</span>
                </>
              )}
            </span>
            <span className="text-amber-400 font-mono shrink-0 ml-2">{loadProgress}%</span>
          </div>

          {/* Smooth Horizontal Progress Bar */}
          <div className="w-full h-2.5 sm:h-3 bg-slate-900 rounded-full border border-amber-600/50 p-0.5 overflow-hidden shadow-inner">
            <div
              style={{ width: `${loadProgress}%` }}
              className={`h-full rounded-full transition-all duration-150 ${
                isReady
                  ? 'bg-gradient-to-r from-amber-500 via-emerald-400 to-emerald-500 shadow-emerald-500/40'
                  : 'bg-gradient-to-r from-amber-600 via-amber-400 to-amber-300 shadow-amber-500/40'
              }`}
            />
          </div>
        </div>
      </div>

      {/* 
        3. TOMBOL MULAI DI POJOK KANAN BAWAH (BOTTOM-RIGHT CORNER)
        Placed directly over the cover image at bottom-right with safe margins.
        Disabled during asset load, active and bold when ready.
        Zero Sparkles (✨).
      */}
      <div className="absolute bottom-5 sm:bottom-7 right-4 sm:right-8 z-30 pointer-events-auto">
        <button
          onClick={handleStartGame}
          disabled={!isReady}
          className={`py-3 sm:py-3.5 px-6 sm:px-9 rounded-2xl font-pirate font-bold text-base sm:text-xl tracking-wider shadow-2xl flex items-center gap-2.5 transition-all transform cursor-pointer ${
            isReady
              ? 'bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 hover:from-amber-400 hover:to-amber-500 text-amber-950 border-2 border-amber-300 shadow-amber-500/40 hover:scale-105 active:scale-95'
              : 'bg-slate-900/90 text-slate-500 border border-slate-700 cursor-not-allowed opacity-80 backdrop-blur-xs'
          }`}
        >
          <Play className={`w-4 h-4 sm:w-5 sm:h-5 ${isReady ? 'fill-current text-amber-950' : 'text-slate-500'}`} />
          <span>{isReady ? 'MULAI' : 'MEMUAT'}</span>
          {isReady && <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-amber-950" />}
        </button>
      </div>
    </div>
  );
};
