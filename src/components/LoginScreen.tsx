/**
 * LoginScreen Component for Pirate Academy: Treasure Quest
 * Features:
 * 1. Premium Glassmorphism Card (backdrop-blur-xl, subtle glowing border, modern typography)
 * 2. Background Artwork featuring the uploaded photo: /assets/aistudio/Kolase_Noir_Pria_di_Kota_Berkabut_692148ea.png
 * 3. Dedicated easily replaceable background constant (IDENTITY_BACKGROUND_PATH)
 * 4. Zero Sparkles (✨) icons
 * Created by Deni Raja99
 */

import React, { useState } from 'react';
import { Compass, BookOpen, Shield, Play, Volume2, VolumeX, Anchor, User, GraduationCap, ChevronLeft, ArrowRight } from 'lucide-react';
import { sounds } from '../services/audio';

/**
 * LOKASI PENGGANTIAN FOTO BACKGROUND IDENTITAS:
 * Foto background halaman identitas dapat diganti langsung dengan mengubah path berikut
 * atau menimpa file di: /public/assets/aistudio/Kolase_Noir_Pria_di_Kota_Berkabut_692148ea.png
 */
export const IDENTITY_BACKGROUND_PATH = '/assets/aistudio/Kolase_Noir_Pria_di_Kota_Berkabut_692148ea.png';

import {
  normalizeAllowedGrade,
  STUDENT_GRADE_OPTIONS,
  type QuestionPackage,
} from '../types/game';

interface LoginScreenProps {
  activePackage: QuestionPackage | null;
  quizLoadError?: string;
  isStarting?: boolean;
  initialName?: string;
  initialGrade?: string;
  onStartGame: (name: string, grade: string) => void;
  onOpenInstructions: () => void;
  onOpenTeacherDashboard: () => void;
  onBackToCover?: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  activePackage,
  quizLoadError,
  isStarting,
  initialName = '',
  initialGrade,
  onStartGame,
  onOpenInstructions,
  onOpenTeacherDashboard,
  onBackToCover,
}) => {
  const [name, setName] = useState(initialName);
  const [grade, setGrade] = useState<string>(() => normalizeAllowedGrade(initialGrade) || 'Kelas 5');
  const [error, setError] = useState('');
  const [isMuted, setIsMuted] = useState(sounds.getMuted());

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (isStarting) return;

    const finalName = name.trim();
    if (!finalName) {
      setError('Tolong masukkan nama siswa petualang terlebih dahulu!');
      return;
    }

    const validatedGrade = normalizeAllowedGrade(grade);
    if (!validatedGrade) {
      setError('Pilih kelas yang tersedia: Kelas IV (4), Kelas V (5), atau Kelas VI (6).');
      return;
    }

    sounds.unlockAudio();
    sounds.playClick();
    sounds.playChestOpen();
    onStartGame(finalName, validatedGrade);
  };

  const toggleSound = () => {
    const muted = sounds.toggleMute();
    setIsMuted(muted);
  };

  return (
    <div className="relative w-full h-full min-h-screen flex items-center justify-center p-4 overflow-y-auto select-none bg-slate-950">
      {/* 
        A. BACKGROUND FOTO PENGGUNA
        Menggunakan file uploaded: /assets/aistudio/Kolase_Noir_Pria_di_Kota_Berkabut_692148ea.png
        Komposisi cover penuh dengan posisi tengah agar subjek utama tetap terlihat tajam.
      */}
      <img
        src={IDENTITY_BACKGROUND_PATH}
        alt="Identity Screen Artwork Background - Deni Raja99"
        className="absolute inset-0 w-full h-full object-cover object-center pointer-events-none filter contrast-105"
      />

      {/* Soft Atmospheric Dark Scrim for High Text Legibility */}
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/92 via-slate-950/65 to-slate-950/45 pointer-events-none" />

      {/* TOP BAR ACTIONS: Back to Cover & Sound Toggle */}
      <div className="absolute top-5 sm:top-6 left-4 sm:left-6 right-4 sm:right-6 flex items-center justify-between z-20 pointer-events-auto">
        {onBackToCover && (
          <button
            type="button"
            onClick={() => {
              sounds.playClick();
              onBackToCover();
            }}
            className="px-3.5 py-2 rounded-xl bg-[#0b1422]/90 hover:bg-[#132036] border border-amber-500/45 text-amber-200 shadow-lg cursor-pointer transition-colors flex items-center gap-1.5 text-xs font-bold"
          >
            <ChevronLeft className="w-4 h-4 text-amber-400" />
            <span>Layar Cover</span>
          </button>
        )}

        <button
          type="button"
          onClick={toggleSound}
          className="p-2.5 rounded-xl bg-[#0b1422]/90 hover:bg-[#132036] border border-amber-500/45 text-amber-200 shadow-lg cursor-pointer transition-colors flex items-center gap-1.5 text-xs font-bold"
          title={isMuted ? 'Nyalakan Suara' : 'Matikan Suara'}
          aria-label={isMuted ? 'Nyalakan Efek Suara' : 'Matikan Efek Suara'}
        >
          {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-amber-400" />}
          <span className="hidden sm:inline">{isMuted ? 'Muted' : 'Audio On'}</span>
        </button>
      </div>

      {/* PANEL IDENTITAS SISWA */}
      <div className="relative z-10 w-full max-w-lg my-auto bg-[#0b1422]/92 border border-amber-500/45 rounded-2xl p-6 sm:p-8 shadow-2xl text-white">
        {/* Header Emblem */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-14 h-14 rounded-xl bg-[#132036] border-2 border-amber-400/70 shadow-lg mb-3 flex items-center justify-center">
            <Compass className="w-8 h-8 text-amber-400" />
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold font-pirate tracking-wider text-amber-300">
            PIRATE ACADEMY
          </h1>
          <p className="text-xs text-amber-200/80 font-cinzel font-medium mt-0.5">
            Registrasi Petualang Sebelum Mengarungi Samudra 3D
          </p>
        </div>

        {/* FORM IDENTITAS PEMAIN */}
        <form onSubmit={handleStart} className="space-y-4">
          <div>
            <label
              htmlFor="student-name-input"
              className="text-xs font-bold uppercase tracking-wider text-amber-200 mb-1.5 flex items-center gap-1.5"
            >
              <User className="w-3.5 h-3.5 text-amber-400" />
              <span>Nama Siswa Petualang:</span>
            </label>
            <input
              id="student-name-input"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError('');
              }}
              placeholder="Contoh: Budi Santoso"
              className="w-full px-4 py-3 rounded-xl bg-slate-950/90 border border-amber-500/45 text-white placeholder-slate-400 font-semibold focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-500/30 transition-colors text-sm"
              maxLength={40}
              autoFocus
            />
          </div>

          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-amber-200 mb-1.5 flex items-center gap-1.5">
              <GraduationCap className="w-3.5 h-3.5 text-amber-400" />
              <span>Pilih Kelas (IV – VI):</span>
            </span>
            <div className="grid grid-cols-3 gap-2.5" role="radiogroup" aria-label="Pilih Kelas Siswa">
              {STUDENT_GRADE_OPTIONS.map((opt) => {
                const isSelected = grade === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => {
                      sounds.playClick();
                      setGrade(opt.value);
                      setError('');
                    }}
                    className={`py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold border transition-colors cursor-pointer whitespace-nowrap ${
                      isSelected
                        ? 'bg-amber-500 text-slate-950 border-amber-300 shadow-md'
                        : 'bg-slate-950/75 hover:bg-slate-900 text-slate-200 border-amber-600/35 hover:border-amber-400/60'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Published Quiz Notice or Honest Empty Error */}
          {activePackage ? (
            <div className="p-3 bg-emerald-950/65 border border-emerald-500/45 rounded-xl text-xs text-emerald-200">
              <div className="font-bold text-emerald-300">
                Misi Aktif: {activePackage.title}
              </div>
              <div className="text-[11px] text-slate-300 mt-0.5 tabular-nums">
                {activePackage.questions.length} Peti Soal · {activePackage.gradeLevel}
              </div>
            </div>
          ) : (
            <div className="p-3 bg-red-950/80 border border-red-500/70 text-red-200 rounded-xl text-xs space-y-1.5">
              <div className="font-bold text-red-300">
                Belum Ada Kuis Aktif yang Diterbitkan Guru
              </div>
              <p className="text-[11px] leading-relaxed">
                {quizLoadError ||
                  'Portal Guru belum menerbitkan paket soal aktif. Hubungi guru untuk menerbitkan soal melalui Portal Guru.'}
              </p>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="p-3 bg-red-950/80 border border-red-500/70 text-red-200 rounded-xl text-xs font-semibold flex items-center gap-2"
            >
              <span>{error}</span>
            </div>
          )}

          {/* Tombol Utama Mulai Petualangan */}
          <button
            type="submit"
            disabled={!activePackage || isStarting}
            className="w-full py-3.5 px-6 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-black text-base font-cinzel tracking-wider uppercase shadow-lg border border-amber-300 flex items-center justify-center gap-2.5 cursor-pointer transition-colors mt-2"
          >
            <Play className="w-5 h-5 fill-current" />
            <span>{isStarting ? 'Memuat Petualangan...' : 'Mulai Petualangan 3D'}</span>
            <ArrowRight className="w-4 h-4 text-slate-950" />
          </button>
        </form>

        {/* Secondary Action Buttons */}
        <div className="grid grid-cols-2 gap-3 mt-5 pt-4 border-t border-amber-500/20">
          <button
            type="button"
            onClick={() => {
              sounds.playClick();
              onOpenInstructions();
            }}
            className="py-2.5 px-3 rounded-xl bg-slate-950/75 hover:bg-slate-900 border border-amber-600/35 text-amber-200 text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <BookOpen className="w-4 h-4 text-amber-400" />
            <span>Petunjuk Kontrol</span>
          </button>

          <button
            type="button"
            onClick={() => {
              sounds.playClick();
              onOpenTeacherDashboard();
            }}
            className="py-2.5 px-3 rounded-xl bg-slate-950/75 hover:bg-slate-900 border border-amber-600/35 text-amber-200 text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Shield className="w-4 h-4 text-amber-400" />
            <span>Portal Guru</span>
          </button>
        </div>

        {/* Quiet Unboxed Creator Credit */}
        <div className="mt-5 pt-3 border-t border-amber-500/15 text-center text-[11px] text-slate-400 flex items-center justify-center gap-1.5">
          <Anchor className="w-3 h-3 text-amber-400/80" />
          <span>
            Pirate Academy 3D · Karya <strong className="text-amber-200/90">Deni Raja99</strong>
          </span>
        </div>
      </div>
    </div>
  );
};
