/**
 * InstructionScreen Component for Pirate Academy
 * Created by Deni Raja99
 */

import React from 'react';
import { Compass, Key, MousePointer, Smartphone, CheckCircle, X, Award } from 'lucide-react';
import { sounds } from '../services/audio';

interface InstructionScreenProps {
  onClose: () => void;
}

export const InstructionScreen: React.FC<InstructionScreenProps> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/75 backdrop-blur-xs select-none">
      <div className="relative w-full max-w-2xl bg-gradient-to-b from-amber-950 via-slate-900 to-slate-950 border-2 border-amber-500/80 rounded-3xl p-6 sm:p-8 text-white shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-amber-600/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-400 flex items-center justify-center text-amber-400">
              <Compass className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-bold font-pirate text-amber-300">
                Petunjuk Bermain Bajak Laut
              </h2>
              <p className="text-xs text-amber-200/80">Panduan lengkap menjelajahi Pulau Harta Karun</p>
            </div>
          </div>

          <button
            onClick={() => {
              sounds.playClick();
              onClose();
            }}
            className="p-2 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content sections */}
        <div className="space-y-5 my-6 text-sm">
          {/* 1. Misi Utama */}
          <div className="bg-amber-900/30 border border-amber-600/40 p-4 rounded-2xl">
            <h3 className="font-bold font-cinzel text-amber-300 flex items-center gap-2 mb-2">
              <Award className="w-4 h-4 text-amber-400" />
              Misi Utama Petualang
            </h3>
            <p className="text-slate-200 text-xs sm:text-sm leading-relaxed">
              Jelajahi pulau tropis, temukan seluruh <strong>Peti Harta Karun</strong> yang memancarkan pilar cahaya emas. Tiap peti berisi soal tantangan. Jawab semua soal untuk mengumpulkan koin emas dan raih <strong>Sertifikat Petualang Bajak Laut Cilik</strong>!
            </p>
          </div>

          {/* 2. Kontrol Komputer / Laptop */}
          <div className="bg-slate-900/80 border border-slate-700 p-4 rounded-2xl">
            <h3 className="font-bold text-amber-300 flex items-center gap-2 mb-3">
              <Key className="w-4 h-4 text-amber-400" />
              Kontrol Komputer / Laptop (Keyboard & Mouse)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="flex items-center gap-2.5 bg-slate-800/80 p-2.5 rounded-xl border border-slate-700">
                <span className="px-2 py-1 bg-amber-500 text-amber-950 font-bold rounded">W, A, S, D</span>
                <span className="text-slate-200">Bergerak (Maju, Kiri, Mundur, Kanan)</span>
              </div>
              <div className="flex items-center gap-2.5 bg-slate-800/80 p-2.5 rounded-xl border border-slate-700">
                <span className="px-2 py-1 bg-amber-500 text-amber-950 font-bold rounded">E / Enter</span>
                <span className="text-slate-200">Membuka Peti Harta Karun</span>
              </div>
              <div className="flex items-center gap-2.5 bg-slate-800/80 p-2.5 rounded-xl border border-slate-700">
                <span className="px-2 py-1 bg-amber-500 text-amber-950 font-bold rounded">Spasi (Space)</span>
                <span className="text-slate-200">Melompat</span>
              </div>
              <div className="flex items-center gap-2.5 bg-slate-800/80 p-2.5 rounded-xl border border-slate-700">
                <span className="px-2 py-1 bg-amber-500 text-amber-950 font-bold rounded">Klik & Geser</span>
                <span className="text-slate-200">Memutar Kamera (Sudut Pandang)</span>
              </div>
            </div>
          </div>

          {/* 3. Kontrol HP / Tablet (Sentuh) */}
          <div className="bg-slate-900/80 border border-slate-700 p-4 rounded-2xl">
            <h3 className="font-bold text-amber-300 flex items-center gap-2 mb-3">
              <Smartphone className="w-4 h-4 text-amber-400" />
              Kontrol HP & Layar Sentuh
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="flex items-center gap-2.5 bg-slate-800/80 p-2.5 rounded-xl border border-slate-700">
                <span className="w-8 h-8 rounded-full bg-amber-500/30 border border-amber-400 flex items-center justify-center font-bold text-amber-300">🕹️</span>
                <span className="text-slate-200">Joystick Virtual di kiri bawah untuk berjalan</span>
              </div>
              <div className="flex items-center gap-2.5 bg-slate-800/80 p-2.5 rounded-xl border border-slate-700">
                <span className="w-8 h-8 rounded-full bg-amber-500 text-amber-950 flex items-center justify-center font-bold">E</span>
                <span className="text-slate-200">Tombol Aksi di kanan bawah untuk buka peti</span>
              </div>
            </div>
          </div>

          {/* 4. Tips Mengerjakan */}
          <div className="bg-emerald-950/40 border border-emerald-600/40 p-4 rounded-2xl text-xs space-y-1.5 text-emerald-200">
            <div className="font-bold text-sm text-emerald-300 flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              Aturan Pengerjaan & Nilai
            </div>
            <p>• Pilihan Ganda: Langsung dinilai secara otomatis setelah dikirim.</p>
            <p>• Uraian Singkat & Esai: Tuliskan penjelasan dengan jelas dan lengkap untuk dinilai guru.</p>
            <p>• Jawaban tersimpan secara otomatis, jadi kamu tidak perlu takut nilaimu hilang.</p>
          </div>
        </div>

        {/* Footer Button */}
        <div className="pt-2 flex justify-end">
          <button
            onClick={() => {
              sounds.playClick();
              onClose();
            }}
            className="w-full sm:w-auto px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-amber-950 font-bold font-cinzel text-sm cursor-pointer transition-colors shadow-lg"
          >
            Mengerti & Siap Berlayar!
          </button>
        </div>
      </div>
    </div>
  );
};
