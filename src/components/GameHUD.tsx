/**
 * GameHUD Component for Pirate Academy: Treasure Quest
 * Features:
 * 1. Compact Player & Mission Progress HUD in Top-Left (PLAYER, SOAL SELESAI, BELUM SELESAI)
 * 2. Settings Gear Button in Top-Right
 * 3. Unified Settings Modal (Kamera, Kontrol, Misi/Peti, Audio, Mode Developer)
 * 4. Responsive Touch Controls for Mobile
 * Created by Deni Raja99
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  User,
  Settings,
  X,
  Volume2,
  VolumeX,
  Music,
  Sliders,
  Compass,
  MapPin,
  Bug,
  Pause,
  FileCheck,
  Lightbulb,
} from 'lucide-react';
import { ChestPlacementMeta, getQuestionTypeLabel, StudentSession, QuestionPackage } from '../types/game';
import { GameConfig } from '../game/GameConfig';
import { CHEST_ZONE_LABELS, getDistributedChestsForQuestions } from '../game/ChestConfig';
import { RaycastDebugData } from '../game/MapEnvironment';
import type { MiniMapLiveState } from '../game/MiniMapTypes';
import { QuestMiniMap } from './QuestMiniMap';
import { FullMapModal } from './FullMapModal';
import { AudioStateSnapshot, sounds } from '../services/audio';

interface GameHUDProps {
  session: StudentSession;
  questionPackage: QuestionPackage;
  gameConfig: GameConfig;
  onUpdateGameConfig: (key: keyof GameConfig, val: number | boolean) => void;
  debugData?: RaycastDebugData | null;
  chestPlacements?: ChestPlacementMeta[];
  miniMapStateRef?: React.MutableRefObject<MiniMapLiveState | null>;
  isFullMapOpen?: boolean;
  onOpenFullMap?: () => void;
  onCloseFullMap?: () => void;
  onPause: () => void;
  onFinishQuest: () => void;
  onOpenInstructions: () => void;
  onVirtualJoystickMove?: (vec: { x: number; y: number }) => void;
  onVirtualInteract?: () => void;
  onVirtualJump?: () => void;
}

export const GameHUD: React.FC<GameHUDProps> = ({
  session,
  questionPackage,
  gameConfig,
  onUpdateGameConfig,
  debugData,
  chestPlacements = [],
  miniMapStateRef,
  isFullMapOpen = false,
  onOpenFullMap,
  onCloseFullMap,
  onPause,
  onFinishQuest,
  onVirtualJoystickMove,
  onVirtualInteract,
  onVirtualJump,
}) => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'camera' | 'controls' | 'chests' | 'audio' | 'debug'>('camera');
  const [audioState, setAudioState] = useState<AudioStateSnapshot>(() => sounds.getState());

  useEffect(() => {
    return sounds.subscribe(setAudioState);
  }, []);

  // Progress Calculations (strictly bound to active published questions)
  const totalChests = questionPackage.questions.length;
  const completedChestsCount = questionPackage.questions.filter(
    (q) => session.chestsCompleted.includes(q.id) || Boolean(session.answers?.[q.id])
  ).length;
  const uncompletedChestsCount = Math.max(totalChests - completedChestsCount, 0);
  const isAllCompleted = completedChestsCount >= totalChests && totalChests > 0;

  // Virtual Joystick State
  const joystickRef = useRef<HTMLDivElement>(null);
  const [stickPos, setStickPos] = useState({ x: 0, y: 0 });
  const [isJoystickActive, setIsJoystickActive] = useState(false);

  const toggleSound = () => {
    sounds.toggleMute();
  };

  const toggleMusic = () => {
    sounds.unlockAudio();
    sounds.toggleMusic();
  };

  const handleJoystickStart = (e: React.TouchEvent | React.MouseEvent) => {
    setIsJoystickActive(true);
    handleJoystickMove(e);
  };

  const handleJoystickMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!joystickRef.current) return;
    const rect = joystickRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;

    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const maxRadius = 45;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const clampedDist = Math.min(dist, maxRadius);
    const angle = Math.atan2(dy, dx);

    const targetX = Math.cos(angle) * clampedDist;
    const targetY = Math.sin(angle) * clampedDist;

    setStickPos({ x: targetX, y: targetY });

    if (onVirtualJoystickMove) {
      onVirtualJoystickMove({
        x: targetX / maxRadius,
        y: targetY / maxRadius,
      });
    }
  };

  const handleJoystickEnd = () => {
    setIsJoystickActive(false);
    setStickPos({ x: 0, y: 0 });
    if (onVirtualJoystickMove) {
      onVirtualJoystickMove({ x: 0, y: 0 });
    }
  };

  return (
    <div className="absolute inset-0 pointer-events-none select-none overflow-hidden z-30 flex flex-col justify-between p-3 sm:p-5">
      {/*
        TOP BAR:
        Left  = Minimalist Horizontal Player HUD Strip ([Nama] | [Kelas] | [X/Y SOAL])
        Right = Control Buttons + Circular Quest Mini-Map directly underneath
      */}
      <div className="flex items-start justify-between gap-2 sm:gap-3 pointer-events-none">
        {/* 1. INFORMASI PLAYER RINGKAS — POJOK KIRI ATAS */}
        <div
          data-testid="minimalist-player-hud"
          className="pointer-events-auto bg-slate-950/65 backdrop-blur-md border border-amber-500/45 rounded-lg px-2.5 py-1.5 sm:px-3.5 sm:py-2 shadow-[0_6px_20px_rgba(0,0,0,0.45)] flex items-center gap-1.5 sm:gap-2.5 font-sans max-w-[calc(100vw-165px)] sm:max-w-lg min-w-0"
        >
          <User className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span
            className="text-white font-bold text-[11px] sm:text-xs md:text-[13px] tracking-wide uppercase truncate min-w-0"
            title={session.student.name}
          >
            {session.student.name}
          </span>

          <span className="text-amber-500/45 text-[10px] sm:text-xs select-none" aria-hidden="true">
            |
          </span>

          <span className="text-amber-200/90 font-semibold text-[10px] sm:text-xs uppercase whitespace-nowrap shrink-0">
            {session.student.grade}
          </span>

          <span className="text-amber-500/45 text-[10px] sm:text-xs select-none" aria-hidden="true">
            |
          </span>

          <span className="text-amber-300 font-semibold text-[10px] sm:text-xs tabular-nums whitespace-nowrap shrink-0">
            {totalChests > 0 ? `${completedChestsCount}/${totalChests} SOAL` : 'MEMUAT SOAL'}
          </span>
        </div>

        {/* 2. TOMBOL PENGATURAN & CIRCULAR QUEST MINI-MAP — POJOK KANAN ATAS */}
        <div className="flex flex-col items-end gap-2.5 sm:gap-3 shrink-0">
          <div className="pointer-events-auto flex items-center gap-1.5 sm:gap-2">
            {/* Certificate Action if all chests completed */}
            {isAllCompleted && (
              <button
                type="button"
                onClick={() => {
                  sounds.playVictory();
                  onFinishQuest();
                }}
                className="py-2 px-3 sm:py-2.5 sm:px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg border border-emerald-400/70 flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <FileCheck className="w-4 h-4" />
                <span className="hidden md:inline">Hasil &amp; Sertifikat</span>
              </button>
            )}

            {/* Pirate Soundtrack Quick Toggle (Independent from SFX) */}
            <button
              type="button"
              onClick={toggleMusic}
              className={`p-2 sm:p-2.5 rounded-xl bg-[#0b1422]/85 hover:bg-[#132036] border shadow-xl cursor-pointer transition-colors flex items-center gap-1.5 ${
                !audioState.musicEnabled
                  ? 'border-red-500/50 text-red-400'
                  : audioState.musicBlocked
                  ? 'border-amber-400 text-amber-300 animate-pulse'
                  : 'border-amber-600/50 text-amber-300'
              }`}
              title={
                !audioState.musicEnabled
                  ? 'Nyalakan Musik Latar'
                  : audioState.musicBlocked
                  ? 'Klik untuk Memutar Musik Latar'
                  : 'Matikan Musik Latar'
              }
              aria-label={audioState.musicEnabled ? 'Matikan Musik Latar' : 'Nyalakan Musik Latar'}
            >
              <Music className={`w-4 h-4 sm:w-5 sm:h-5 ${!audioState.musicEnabled ? 'text-red-400 opacity-75' : 'text-amber-400'}`} />
            </button>

            {/* SFX Sound Mute/Unmute (Independent from Music) */}
            <button
              type="button"
              onClick={toggleSound}
              className="p-2 sm:p-2.5 rounded-xl bg-[#0b1422]/85 hover:bg-[#132036] border border-amber-600/50 text-amber-300 shadow-xl cursor-pointer transition-colors"
              title={audioState.sfxMuted ? 'Nyalakan Efek Suara (SFX)' : 'Bisukan Efek Suara (SFX)'}
              aria-label={audioState.sfxMuted ? 'Nyalakan Efek Suara' : 'Bisukan Efek Suara'}
            >
              {audioState.sfxMuted ? <VolumeX className="w-4 h-4 sm:w-5 sm:h-5 text-red-400" /> : <Volume2 className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400" />}
            </button>

            {/* Pause Button */}
            <button
              type="button"
              onClick={() => {
                sounds.playClick();
                onPause();
              }}
              className="p-2 sm:p-2.5 rounded-xl bg-[#0b1422]/85 hover:bg-[#132036] border border-amber-600/50 text-amber-300 shadow-xl cursor-pointer transition-colors"
              title="Menu Jeda (Pause)"
              aria-label="Jeda Permainan"
            >
              <Pause className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            {/* Settings Gear Button */}
            <button
              type="button"
              onClick={() => {
                sounds.playClick();
                setIsSettingsOpen(!isSettingsOpen);
              }}
              className={`p-2 sm:p-2.5 rounded-xl border shadow-xl cursor-pointer transition-colors ${
                isSettingsOpen
                  ? 'bg-amber-500 text-slate-950 border-amber-200 ring-2 ring-amber-400/50'
                  : 'bg-[#0b1422]/85 hover:bg-[#132036] border-amber-500/65 text-amber-300'
              }`}
              title="Pengaturan Game Terpadu"
              aria-label="Buka Pengaturan Game"
            >
              <Settings className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>

          {/* Circular Tactical Quest Mini-Map directly beneath top-right controls (clickable for Full Map) */}
          {miniMapStateRef && (
            <QuestMiniMap
              miniMapStateRef={miniMapStateRef}
              onOpenFullMap={() => {
                setIsSettingsOpen(false);
                onOpenFullMap?.();
              }}
            />
          )}
        </div>
      </div>

      {/* Live Tahap 2 Diagnostics Strip — Strictly visible ONLY when Developer Debug Mode is ON */}
      {gameConfig.debugMode && debugData && (
        <div className="self-start bg-slate-950/90 border border-emerald-500/70 rounded-xl p-2.5 font-mono text-[10px] text-slate-200 shadow-2xl max-w-md space-y-0.5 backdrop-blur-xs">
          <div className="text-emerald-400 font-bold">
            [DEV DEBUG] Diagnostik Gerak & Collider
          </div>
          <div>
            Prev: ({debugData.prevPos.x.toFixed(2)}, {debugData.prevPos.y.toFixed(2)}, {debugData.prevPos.z.toFixed(2)}) → Desired: ({debugData.desiredPos.x.toFixed(2)}, {debugData.desiredPos.z.toFixed(2)})
          </div>
          <div>
            Actual: ({debugData.footPos.x.toFixed(2)}, {debugData.footPos.y.toFixed(2)}, {debugData.footPos.z.toFixed(2)}) • Walkable: <span className={debugData.isWalkableSurface ? 'text-emerald-400' : 'text-red-400'}>{String(debugData.isWalkableSurface)}</span> ({debugData.surfaceCategory})
          </div>
          <div>
            Boundary: <span className={debugData.isAtBoundary ? 'text-red-400 font-bold' : 'text-emerald-400'}>{debugData.isAtBoundary ? 'BLOCKED' : 'CLEAR'}</span> • Collider: <span className="text-cyan-300">{debugData.blockingColliderId || debugData.detectedMeshName}</span>
          </div>
          <div className={debugData.isAtBoundary || debugData.isCollidingObstacle ? 'text-amber-300' : 'text-slate-300'}>
            Status: {debugData.blockingReason}
          </div>
          <div>
            Finish Trigger: {debugData.isInsideFinishZone ? (isAllCompleted ? 'AKTIF (MENANG)' : `DI DALAM ZONA (${completedChestsCount}/${totalChests})`) : `Menuju Finish (${debugData.finishDistance.toFixed(1)}m)`}
          </div>
        </div>
      )}

      {/* 
        3. UNIFIED SETTINGS MODAL (PANEL PENGATURAN GAME TERPADU)
        Consolidates Kamera, Kontrol, Misi/Peti, Audio, and Developer Debug into ONE menu!
      */}
      {isSettingsOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Pengaturan Game Pirate Academy"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/70 pointer-events-auto select-none"
        >
          <div className="relative w-full max-w-2xl bg-[#0b1422] border-2 border-amber-500/70 rounded-2xl shadow-2xl overflow-hidden flex flex-col text-slate-200">
            {/* Modal Header */}
            <div className="bg-[#111c2d] px-5 py-4 border-b border-amber-500/30 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500 text-slate-950 flex items-center justify-center font-bold">
                  <Settings className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-pirate font-bold text-lg sm:text-xl text-amber-300 tracking-wide">
                    PENGATURAN GAME
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Sesuaikan kamera, kontrol, panduan misi, dan audio permainan.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  sounds.playClick();
                  setIsSettingsOpen(false);
                }}
                className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="Tutup Pengaturan"
                aria-label="Tutup Pengaturan"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Tabs */}
            <div className="flex items-center gap-1 border-b border-slate-800 px-4 pt-2 overflow-x-auto text-xs font-bold">
              <button
                type="button"
                onClick={() => setSettingsTab('camera')}
                className={`py-2 px-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                  settingsTab === 'camera'
                    ? 'border-amber-400 text-amber-300'
                    : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Kamera &amp; Kecepatan</span>
              </button>

              <button
                type="button"
                onClick={() => setSettingsTab('controls')}
                className={`py-2 px-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                  settingsTab === 'controls'
                    ? 'border-amber-400 text-amber-300'
                    : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >
                <Compass className="w-3.5 h-3.5" />
                <span>Kontrol</span>
              </button>

              <button
                type="button"
                onClick={() => setSettingsTab('chests')}
                className={`py-2 px-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                  settingsTab === 'chests'
                    ? 'border-amber-400 text-amber-300'
                    : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >
                <MapPin className="w-3.5 h-3.5" />
                <span>Daftar Peti ({completedChestsCount}/{totalChests})</span>
              </button>

              <button
                type="button"
                onClick={() => setSettingsTab('audio')}
                className={`py-2 px-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                  settingsTab === 'audio'
                    ? 'border-amber-400 text-amber-300'
                    : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>Audio</span>
              </button>

              <button
                type="button"
                onClick={() => setSettingsTab('debug')}
                className={`py-2 px-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                  settingsTab === 'debug'
                    ? 'border-emerald-400 text-emerald-300'
                    : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >
                <Bug className="w-3.5 h-3.5" />
                <span>Developer &amp; Debug</span>
              </button>
            </div>

            {/* Tab Contents */}
            <div className="p-5 overflow-y-auto max-h-[60vh] space-y-4 text-xs">
              {/* TAB 1: KAMERA & KECEPATAN */}
              {settingsTab === 'camera' && (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <div className="flex justify-between font-bold">
                      <span className="text-slate-300">Jarak Kamera (Camera Distance):</span>
                      <span className="text-amber-400 font-mono">{gameConfig.cameraDistance}m</span>
                    </div>
                    <input
                      type="range"
                      min={3.0}
                      max={9.0}
                      step={0.2}
                      value={gameConfig.cameraDistance}
                      onChange={(e) => onUpdateGameConfig('cameraDistance', parseFloat(e.target.value))}
                      className="w-full accent-amber-500 cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-slate-500">
                      <span>Dekat (3m)</span>
                      <span>Bawaan (5.4m)</span>
                      <span>Jauh (9m)</span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between font-bold">
                      <span className="text-slate-300">Tinggi Kamera (Camera Height):</span>
                      <span className="text-amber-400 font-mono">{gameConfig.cameraHeight}m</span>
                    </div>
                    <input
                      type="range"
                      min={1.2}
                      max={4.0}
                      step={0.1}
                      value={gameConfig.cameraHeight}
                      onChange={(e) => onUpdateGameConfig('cameraHeight', parseFloat(e.target.value))}
                      className="w-full accent-amber-500 cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-slate-500">
                      <span>Rendah (1.2m)</span>
                      <span>Bawaan (2.1m)</span>
                      <span>Tinggi (4.0m)</span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between font-bold">
                      <span className="text-slate-300">Kecepatan Karakter Edgar:</span>
                      <span className="text-amber-400 font-mono">{gameConfig.movementSpeed} m/s</span>
                    </div>
                    <input
                      type="range"
                      min={4.0}
                      max={14.0}
                      step={0.5}
                      value={gameConfig.movementSpeed}
                      onChange={(e) => onUpdateGameConfig('movementSpeed', parseFloat(e.target.value))}
                      className="w-full accent-amber-500 cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-slate-500">
                      <span>Santai (4 m/s)</span>
                      <span>Standar (7.5 m/s)</span>
                      <span>Cepat (14 m/s)</span>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: KONTROL */}
              {settingsTab === 'controls' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div className="bg-slate-900/90 border border-slate-800 p-3 rounded-xl flex items-center gap-3">
                      <span className="font-mono font-bold text-amber-400 bg-slate-800 px-2 py-1 rounded border border-slate-700">
                        W / A / S / D
                      </span>
                      <div>
                        <div className="font-bold text-white">Gerak Karakter</div>
                        <div className="text-[11px] text-slate-400">Maju, mundur, kiri, kanan</div>
                      </div>
                    </div>

                    <div className="bg-slate-900/90 border border-slate-800 p-3 rounded-xl flex items-center gap-3">
                      <span className="font-mono font-bold text-amber-400 bg-slate-800 px-2.5 py-1 rounded border border-slate-700">
                        E / Enter
                      </span>
                      <div>
                        <div className="font-bold text-white">Buka Peti Soal</div>
                        <div className="text-[11px] text-slate-400">Saat mendekati peti harta</div>
                      </div>
                    </div>

                    <div className="bg-slate-900/90 border border-slate-800 p-3 rounded-xl flex items-center gap-3">
                      <span className="font-mono font-bold text-amber-400 bg-slate-800 px-2 py-1 rounded border border-slate-700">
                        Spasi
                      </span>
                      <div>
                        <div className="font-bold text-white">Lompat</div>
                        <div className="text-[11px] text-slate-400">Melompati rintangan kecil</div>
                      </div>
                    </div>

                    <div className="bg-slate-900/90 border border-slate-800 p-3 rounded-xl flex items-center gap-3">
                      <span className="font-mono font-bold text-amber-400 bg-slate-800 px-2 py-1 rounded border border-slate-700">
                        Klik & Tarik
                      </span>
                      <div>
                        <div className="font-bold text-white">Putar Kamera</div>
                        <div className="text-[11px] text-slate-400">Orbit sudut pandang 360°</div>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 bg-amber-950/40 border border-amber-800/50 rounded-xl text-[11px] text-amber-200 flex items-start gap-2">
                    <Lightbulb className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span>
                      <strong>Tips Mobile:</strong> Gunakan virtual joystick di kiri bawah layar untuk mengarahkan langkah dan tombol <strong>Lompat</strong> serta <strong>[E]</strong> di kanan bawah.
                    </span>
                  </div>
                </div>
              )}

              {/* TAB 3: DAFTAR PETI & MISI */}
              {settingsTab === 'chests' && (
                <div className="space-y-2">
                  <div className="text-xs text-slate-400 mb-1">
                    Berikut status peti harta karun di sepanjang lintasan petualangan 750m:
                  </div>

                  <div className="space-y-1.5 max-h-[45vh] overflow-y-auto pr-1">
                    {(() => {
                      const fallbackWaypoints = getDistributedChestsForQuestions(questionPackage.questions.length);
                      return questionPackage.questions.map((q, idx) => {
                        const isDone = session.chestsCompleted.includes(q.id);
                        const mapping = questionPackage.chestMappings?.find((m) => m.questionId === q.id);
                        const wp = fallbackWaypoints[idx];
                        const zoneType = mapping?.zoneType || q.zoneType || wp?.zoneType || 'main_path';
                        const locName = mapping?.locationName || q.locationName || wp?.name || `Peti #${q.number}`;
                        return (
                          <div
                            key={`${q.id}-${idx}`}
                            className={`p-2.5 rounded-xl border flex items-center justify-between text-xs transition-all ${
                              isDone
                                ? 'bg-emerald-950/40 border-emerald-500/60 text-emerald-200'
                                : 'bg-slate-900/80 border-slate-800 text-slate-300'
                            }`}
                          >
                            <div className="flex items-center gap-2.5">
                              <span
                                className={`w-6 h-6 rounded-lg font-bold flex items-center justify-center text-xs ${
                                  isDone ? 'bg-emerald-600 text-white' : 'bg-amber-600 text-white'
                                }`}
                              >
                                {q.number}
                              </span>
                              <div>
                                <div className="font-bold text-white">{locName}</div>
                                <div className="text-[10px] text-slate-400">
                                  {CHEST_ZONE_LABELS[zoneType]} • {q.points} Poin • {getQuestionTypeLabel(q.type)}
                                </div>
                              </div>
                            </div>

                            <div>
                              {isDone ? (
                                <span className="bg-emerald-500/20 text-emerald-300 font-bold px-2 py-0.5 rounded-full border border-emerald-500/40 text-[10px]">
                                  SELESAI
                                </span>
                              ) : (
                                <span className="bg-amber-500/20 text-amber-300 font-bold px-2 py-0.5 rounded-full border border-amber-500/40 text-[10px]">
                                  BELUM
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}

              {/* TAB 4: AUDIO */}
              {settingsTab === 'audio' && (
                <div className="space-y-4">
                  {/* Musik Latar Bajak Laut (Soundtrack) */}
                  <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-white flex items-center gap-1.5">
                            <Music className="w-4 h-4 text-amber-400 shrink-0" />
                            <span>Musik Latar Bajak Laut</span>
                          </span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                              !audioState.musicEnabled
                                ? 'bg-red-950/80 border-red-500/60 text-red-300'
                                : audioState.musicBlocked
                                ? 'bg-amber-950/80 border-amber-500/70 text-amber-300'
                                : 'bg-emerald-950/80 border-emerald-500/60 text-emerald-300'
                            }`}
                          >
                            {!audioState.musicEnabled
                              ? 'Mati (Mute)'
                              : audioState.musicBlocked
                              ? 'Menunggu Klik'
                              : audioState.musicPlaying
                              ? 'Aktif • Diputar'
                              : 'Aktif'}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          Soundtrack petualangan laut selama eksplorasi &amp; menjawab soal
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={toggleMusic}
                        className={`px-3.5 py-1.5 rounded-xl font-bold text-xs cursor-pointer transition-colors shrink-0 ${
                          !audioState.musicEnabled
                            ? 'bg-red-950 border border-red-500 text-red-300 hover:bg-red-900/70'
                            : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                        }`}
                      >
                        {audioState.musicEnabled ? 'Musik On' : 'Musik Off'}
                      </button>
                    </div>

                    {audioState.musicEnabled && audioState.musicBlocked && (
                      <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-amber-950/50 border border-amber-500/50 text-[11px] text-amber-200">
                        <span>Browser menahan putar otomatis. Klik tombol di kanan untuk memutar musik.</span>
                        <button
                          type="button"
                          onClick={() => {
                            sounds.unlockAudio();
                            sounds.setMusicEnabled(true);
                            sounds.startGameplayMusic();
                          }}
                          className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold shrink-0 cursor-pointer"
                        >
                          Putar Musik
                        </button>
                      </div>
                    )}

                    {/* Volume Slider Musik (0% - 100%, Default 25%) */}
                    <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
                      <div className="flex items-center justify-between font-bold">
                        <label htmlFor="pirate-music-volume" className="text-slate-300">
                          Volume Musik Latar:
                        </label>
                        <span className="text-amber-400 font-mono tabular-nums">
                          {Math.round(audioState.musicVolume * 100)}%
                        </span>
                      </div>
                      <input
                        id="pirate-music-volume"
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={Math.round(audioState.musicVolume * 100)}
                        onChange={(e) => {
                          const pct = Number(e.target.value);
                          sounds.unlockAudio();
                          sounds.setMusicVolume(pct / 100);
                        }}
                        className="w-full accent-amber-500 cursor-pointer"
                      />
                      <div className="flex justify-between text-[10px] text-slate-500">
                        <span>0% (Senyap)</span>
                        <span>25% (Nyaman / Bawaan)</span>
                        <span>100% (Maksimal)</span>
                      </div>
                    </div>
                  </div>

                  {/* Efek Suara Permainan (SFX - Terpisah dari Musik) */}
                  <div className="flex items-center justify-between p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
                    <div>
                      <div className="font-bold text-white">Efek Suara Permainan (SFX)</div>
                      <div className="text-[11px] text-slate-400">Langkah kaki, buka peti harta, suara lompat &amp; perayaan</div>
                    </div>

                    <button
                      type="button"
                      onClick={toggleSound}
                      className={`px-3.5 py-1.5 rounded-xl font-bold text-xs cursor-pointer transition-colors shrink-0 ${
                        audioState.sfxMuted
                          ? 'bg-red-950 border border-red-500 text-red-300'
                          : 'bg-emerald-600 text-white'
                      }`}
                    >
                      {audioState.sfxMuted ? 'Muted (Bisu)' : 'Aktif (On)'}
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 5: DEVELOPER & COLLISION DEBUG */}
              {settingsTab === 'debug' && (
                <div className="space-y-3 font-mono text-[11px]">
                  <div className="flex items-center justify-between p-3 bg-slate-900 border border-slate-800 rounded-xl">
                    <div>
                      <div className="font-bold text-emerald-400">Mode Debug Visualizer 3D</div>
                      <div className="text-[10px] text-slate-400 font-sans">
                        Tampilkan garis raycast kuning, penanda kaki, dan kontak jembatan di dunia 3D.
                      </div>
                    </div>

                    <button
                      onClick={() => onUpdateGameConfig('debugMode', !gameConfig.debugMode)}
                      className={`px-3 py-1.5 rounded-xl font-bold text-xs cursor-pointer transition-colors ${
                        gameConfig.debugMode
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {gameConfig.debugMode ? 'AKTIF (ON)' : 'NONAKTIF (OFF)'}
                    </button>
                  </div>

                  {debugData && (
                    <div className="p-3 bg-slate-900/90 border border-emerald-500/40 rounded-xl space-y-1 text-slate-300">
                      <div className="text-emerald-300 font-bold mb-1">Telemetry Collision & Batas Terkini:</div>
                      <div>Posisi Sebelum: ({debugData.prevPos.x.toFixed(2)}, {debugData.prevPos.y.toFixed(2)}, {debugData.prevPos.z.toFixed(2)})</div>
                      <div>Posisi Tujuan: ({debugData.desiredPos.x.toFixed(2)}, {debugData.desiredPos.y.toFixed(2)}, {debugData.desiredPos.z.toFixed(2)})</div>
                      <div>Posisi Aktual: ({debugData.footPos.x.toFixed(2)}, {debugData.footPos.y.toFixed(2)}, {debugData.footPos.z.toFixed(2)})</div>
                      <div>Collider Kapsul: r={debugData.playerColliderRadius}m, h={debugData.playerColliderHeight}m</div>
                      <div>Walkable Surface: <span className={debugData.isWalkableSurface ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>{String(debugData.isWalkableSurface).toUpperCase()}</span> ({debugData.surfaceCategory})</div>
                      <div>Mesh / Blocker ID: <span className="text-cyan-300">{debugData.blockingColliderId || debugData.detectedMeshName}</span></div>
                      <div>Alasan Validasi: <span className="text-amber-300">{debugData.blockingReason}</span></div>
                      <div>Tinggi Permukaan: <span className="text-emerald-400 font-bold">{debugData.usedSurfaceHeight.toFixed(3)}m</span></div>
                      <div>
                        Status Gerak:{' '}
                        <span className={debugData.isAtBoundary ? 'text-red-400 font-bold' : debugData.isCollidingObstacle ? 'text-orange-400 font-bold' : 'text-emerald-400'}>
                          {debugData.isAtBoundary
                            ? 'BOUNDARY / WATER BLOCKED'
                            : debugData.isCollidingObstacle
                            ? `SLIDING (${debugData.collidingObstacleLabel || 'Obstacle'})`
                            : debugData.isOnBridge
                            ? 'WOODEN BRIDGE DECK'
                            : 'WALKABLE CLEAR'}
                        </span>
                      </div>
                      <div className="pt-1 border-t border-slate-800 text-[10px] text-slate-400">
                        Jarak Kapal Finish: <span className="text-cyan-300 font-bold">{(debugData.finishDistance ?? 999).toFixed(1)}m</span> • Zona Finish:{' '}
                        <span className={debugData.isInsideFinishZone ? 'text-emerald-400 font-bold' : 'text-slate-400'}>
                          {debugData.isInsideFinishZone
                            ? isAllCompleted
                              ? 'TRIGGER AKTIF (SIAP SELESAI)'
                              : `DALAM ZONA (SISA ${uncompletedChestsCount} SOAL)`
                            : 'OUTSIDE'}
                        </span>
                      </div>
                      <div className="pt-1 border-t border-slate-800 text-[10px] text-slate-400">
                        Index Peta: {debugData.stats.solidObstacleTriangles.toLocaleString()} tris • {debugData.stats.obstaclePrimitivesCount} primitif • Unclassified: {debugData.stats.unclassifiedMeshes.length}
                      </div>
                    </div>
                  )}

                  {chestPlacements.length > 0 && (
                    <div className="p-3 bg-slate-900/90 border border-amber-500/40 rounded-xl space-y-2 text-slate-300">
                      <div className="text-amber-300 font-bold">
                        Validasi Spasial Peti ({chestPlacements.filter((c) => c.valid).length}/{chestPlacements.length} Valid):
                      </div>
                      <div className="space-y-1 max-h-40 overflow-y-auto pr-1 text-[10px]">
                        {chestPlacements.map((cp, i) => (
                          <div key={`dbg-cp-${i}`} className="flex flex-wrap items-center justify-between gap-1 border-b border-slate-800 pb-1">
                            <span className="text-white font-bold">
                              #{i + 1} [{cp.zoneType}]
                            </span>
                            <span className="text-slate-400">
                              ({cp.position.x}, {cp.position.y}, {cp.position.z}) • ny={cp.slopeNormalY}
                            </span>
                            <span className={cp.valid ? (cp.adjusted ? 'text-amber-300' : 'text-emerald-400') : 'text-red-400'}>
                              {cp.valid ? (cp.adjusted ? 'ADJUSTED' : 'OK') : 'ERR'} • {cp.groundMeshName.slice(0, 18)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 bg-[#0b1422] border-t border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  sounds.playClick();
                  setIsSettingsOpen(false);
                }}
                className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-colors cursor-pointer"
              >
                Selesai &amp; Lanjutkan Petualangan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3.5 FULL PIRATE QUEST MAP MODAL */}
      {isFullMapOpen && miniMapStateRef && onCloseFullMap && (
        <FullMapModal
          miniMapStateRef={miniMapStateRef}
          totalQuestions={totalChests}
          completedCount={completedChestsCount}
          onClose={onCloseFullMap}
        />
      )}

      {/* 
        4. MOBILE TOUCH CONTROLS (Only visible on small touch screens)
      */}
      <div className="sm:hidden flex items-end justify-between pointer-events-auto px-2 mb-4">
        {/* Virtual Joystick */}
        <div
          ref={joystickRef}
          onTouchStart={handleJoystickStart}
          onTouchMove={handleJoystickMove}
          onTouchEnd={handleJoystickEnd}
          className="w-28 h-28 rounded-full bg-slate-950/70 border-2 border-amber-500/55 relative flex items-center justify-center touch-none shadow-2xl"
        >
          <div
            style={{
              transform: `translate(${stickPos.x}px, ${stickPos.y}px)`,
            }}
            className={`w-12 h-12 rounded-full border-2 transition-transform ${
              isJoystickActive
                ? 'bg-amber-500 border-white shadow-lg'
                : 'bg-amber-600/80 border-amber-300'
            }`}
          />
        </div>

        {/* Action Buttons: Jump and Open Chest */}
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onTouchStart={(e) => {
              e.preventDefault();
              if (onVirtualJump) onVirtualJump();
            }}
            className="w-14 h-14 rounded-full bg-slate-950/75 border-2 border-amber-400 text-amber-300 font-bold text-xs flex items-center justify-center active:scale-95 shadow-xl cursor-pointer"
          >
            Lompat
          </button>

          <button
            type="button"
            onTouchStart={(e) => {
              e.preventDefault();
              if (onVirtualInteract) onVirtualInteract();
            }}
            aria-label="Buka Peti"
            className="w-16 h-16 rounded-full bg-amber-500 border-2 border-amber-200 text-slate-950 font-pirate font-black text-2xl flex items-center justify-center active:scale-95 shadow-xl cursor-pointer"
          >
            E
          </button>
        </div>
      </div>
    </div>
  );
};
