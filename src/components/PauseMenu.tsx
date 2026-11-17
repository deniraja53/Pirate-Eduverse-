/**
 * PauseMenu Component
 * Created by Deni Raja99
 */

import React from 'react';
import { Play, RotateCcw, Home, BookOpen, Volume2, VolumeX } from 'lucide-react';
import { sounds } from '../services/audio';

interface PauseMenuProps {
  onResume: () => void;
  onRestart: () => void;
  onExitToMenu: () => void;
  onOpenInstructions: () => void;
}

export const PauseMenu: React.FC<PauseMenuProps> = ({
  onResume,
  onRestart,
  onExitToMenu,
  onOpenInstructions,
}) => {
  const [isMuted, setIsMuted] = React.useState(sounds.getMuted());
  const [confirmRestart, setConfirmRestart] = React.useState(false);
  const [confirmExit, setConfirmExit] = React.useState(false);

  const toggleSound = () => {
    const muted = sounds.toggleMute();
    setIsMuted(muted);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs select-none">
      <div className="relative w-full max-w-sm bg-gradient-to-b from-amber-950 to-slate-950 border-2 border-amber-500/80 rounded-3xl p-6 sm:p-8 text-white shadow-2xl text-center">
        <h2 className="text-3xl font-extrabold font-pirate text-amber-400 tracking-wider mb-1">
          PERMAINAN DIJEDA
        </h2>
        <p className="text-xs text-amber-200/80 mb-6 font-cinzel">Istirahat sejenak, Kapten!</p>

        <div className="space-y-3">
          <button
            onClick={() => {
              sounds.playClick();
              onResume();
            }}
            className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-amber-950 font-bold text-sm font-cinzel uppercase shadow-md flex items-center justify-center gap-2 cursor-pointer transition-transform active:scale-95"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Lanjutkan Petualangan</span>
          </button>

          <button
            onClick={() => {
              sounds.playClick();
              onOpenInstructions();
            }}
            className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-amber-600/40 text-amber-200 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors"
          >
            <BookOpen className="w-4 h-4 text-amber-400" />
            <span>Petunjuk Kontrol</span>
          </button>

          <button
            onClick={toggleSound}
            className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-amber-600/40 text-amber-200 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors"
          >
            {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-amber-400" />}
            <span>{isMuted ? 'Nyalakan Suara' : 'Matikan Suara'}</span>
          </button>

          {confirmRestart ? (
            <div className="flex gap-2">
              <button
                onClick={() => {
                  sounds.playClick();
                  onRestart();
                  setConfirmRestart(false);
                }}
                className="flex-1 py-2 px-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs cursor-pointer"
              >
                Ya, Mulai Ulang
              </button>
              <button
                onClick={() => setConfirmRestart(false)}
                className="py-2 px-3 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold cursor-pointer"
              >
                Batal
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                sounds.playClick();
                setConfirmRestart(true);
                setConfirmExit(false);
              }}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-amber-600/40 text-slate-300 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Mulai Ulang Sesi</span>
            </button>
          )}

          {confirmExit ? (
            <div className="flex gap-2">
              <button
                onClick={() => {
                  sounds.playClick();
                  onExitToMenu();
                  setConfirmExit(false);
                }}
                className="flex-1 py-2 px-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs cursor-pointer"
              >
                Ya, Keluar ke Cover
              </button>
              <button
                onClick={() => setConfirmExit(false)}
                className="py-2 px-3 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold cursor-pointer"
              >
                Batal
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                sounds.playClick();
                setConfirmExit(true);
                setConfirmRestart(false);
              }}
              className="w-full py-2.5 px-4 rounded-xl bg-red-950/60 hover:bg-red-900/80 border border-red-700/50 text-red-200 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <Home className="w-4 h-4" />
              <span>Keluar ke Layar Utama</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
