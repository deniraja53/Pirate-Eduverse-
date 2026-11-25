/**
 * FullMapModal Component — Pirate Academy 3D Full Tactical Map Overlay (V10)
 * Opens cleanly when clicking the circular mini-map:
 * - Renders the full adventure corridor using the exact same world coordinates & orientation
 *   (+Z Up = North/Finish, -X Right) as the circular mini-map.
 * - Shows real-time player position & heading (cyan arrow), RED unanswered chests, GREEN answered chests.
 * - Clicking a chest dot displays informational details (name, question number, status) without teleporting.
 * - Supports Escape key, backdrop click, and explicit close button without altering 3D scene or player position.
 * Created by Deni Raja99
 */

import React, { useEffect, useRef, useState } from 'react';
import { X, Compass, MapPin, CheckCircle2, CircleDot, Navigation } from 'lucide-react';
import { FINISH_SHIP_AREA } from '../game/MapEnvironment';
import {
  MiniMapChestPoint,
  MiniMapLiveState,
  projectWorldToRectMap,
} from '../game/MiniMapTypes';
import { sounds } from '../services/audio';

interface FullMapModalProps {
  miniMapStateRef: React.MutableRefObject<MiniMapLiveState | null>;
  totalQuestions: number;
  completedCount: number;
  onClose: () => void;
}

export const FullMapModal: React.FC<FullMapModalProps> = ({
  miniMapStateRef,
  totalQuestions,
  completedCount,
  onClose,
}) => {
  const mapBoxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedChest, setSelectedChest] = useState<MiniMapChestPoint | null>(null);
  const selectedChestIdRef = useRef<string | null>(null);
  const hitTargetsRef = useRef<Array<{ x: number; y: number; r: number; chest: MiniMapChestPoint }>>([]);

  useEffect(() => {
    selectedChestIdRef.current = selectedChest?.questionId || null;
  }, [selectedChest]);

  // Escape key closes full map cleanly
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        sounds.playClick();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Real-time 60fps Canvas 2D full-world renderer reading live mutable ref
  useEffect(() => {
    const container = mapBoxRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let widthPx = container.clientWidth || 460;
    let heightPx = container.clientHeight || 440;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    const applySize = () => {
      widthPx = Math.max(220, container.clientWidth || 460);
      heightPx = Math.max(240, container.clientHeight || 440);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(widthPx * dpr);
      canvas.height = Math.round(heightPx * dpr);
    };

    applySize();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(applySize);
      resizeObserver.observe(container);
    }

    let rafId = 0;

    const renderFrame = (nowMs: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, widthPx, widthPx > 0 ? heightPx : 440);

      // Rich nautical parchment-slate background gradient
      const grad = ctx.createRadialGradient(
        widthPx * 0.5,
        heightPx * 0.5,
        24,
        widthPx * 0.5,
        heightPx * 0.5,
        Math.max(widthPx, heightPx) * 0.65
      );
      grad.addColorStop(0, '#0d2b3e');
      grad.addColorStop(0.65, '#071b2a');
      grad.addColorStop(1, '#04101a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, widthPx, heightPx);

      // Subtle nautical coordinate grid
      ctx.strokeStyle = 'rgba(217, 179, 98, 0.1)';
      ctx.lineWidth = 1;
      const step = 44;
      for (let gx = step; gx < widthPx; gx += step) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, heightPx);
        ctx.stroke();
      }
      for (let gy = step; gy < heightPx; gy += step) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(widthPx, gy);
        ctx.stroke();
      }

      // Compass rose crosshairs & N/U indicator
      ctx.strokeStyle = 'rgba(217, 179, 98, 0.16)';
      ctx.beginPath();
      ctx.moveTo(widthPx * 0.5, 16);
      ctx.lineTo(widthPx * 0.5, heightPx - 16);
      ctx.moveTo(16, heightPx * 0.5);
      ctx.lineTo(widthPx - 16, heightPx * 0.5);
      ctx.stroke();

      ctx.font = '700 11px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(251, 191, 36, 0.85)';
      ctx.fillText('UTARA (KAPAL FINISH)', widthPx * 0.5, 8);

      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(251, 191, 36, 0.65)';
      ctx.fillText('SELATAN (GERBANG START)', widthPx * 0.5, heightPx - 8);

      const state = miniMapStateRef.current;
      const hitTargets: Array<{ x: number; y: number; r: number; chest: MiniMapChestPoint }> = [];

      if (state && state.ready) {
        const { worldBounds, chests, playerX, playerZ, playerRotationY } = state;

        // Subtle Start & Finish Zone reference rings (exact world coordinates)
        const startPt = projectWorldToRectMap(0, 4, worldBounds, widthPx, heightPx, 32);
        const finishPt = projectWorldToRectMap(
          FINISH_SHIP_AREA.triggerCenter.x,
          FINISH_SHIP_AREA.triggerCenter.z,
          worldBounds,
          widthPx,
          heightPx,
          32
        );

        // Start Gate marker
        ctx.beginPath();
        ctx.arc(startPt.x, startPt.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(245, 158, 11, 0.2)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.75)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.font = '700 9px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(253, 230, 138, 0.9)';
        ctx.fillText('START', startPt.x + 11, startPt.y);

        // Finish Ship zone marker
        ctx.beginPath();
        ctx.arc(finishPt.x, finishPt.y, 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(16, 185, 129, 0.22)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.85)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(167, 243, 208, 0.95)';
        ctx.fillText('FINISH', finishPt.x - 11, finishPt.y);

        // Render every active chest marker with question number label & click hit target
        for (let i = 0; i < chests.length; i++) {
          const ch = chests[i];
          if (!ch.active) continue;

          const pt = projectWorldToRectMap(ch.x, ch.z, worldBounds, widthPx, heightPx, 32);
          const isSelected = selectedChestIdRef.current === ch.questionId;

          if (!ch.completed) {
            const pulse = 0.5 + 0.5 * Math.sin(nowMs * 0.0044 + i * 0.85);
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 8 + pulse * 3.5, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(239, 68, 68, ${0.26 - pulse * 0.14})`;
            ctx.fill();
          }

          if (isSelected) {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 11, 0, Math.PI * 2);
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 2;
            ctx.stroke();
          }

          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 6.2, 0, Math.PI * 2);
          ctx.fillStyle = ch.completed ? '#22c55e' : '#ef4444';
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();

          // Small readable number next to dot
          ctx.font = '700 10px ui-sans-serif, system-ui, sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = ch.completed ? '#86efac' : '#fecaca';
          ctx.fillText(`#${ch.questionNumber}`, pt.x + 9, pt.y);

          hitTargets.push({ x: pt.x, y: pt.y, r: 14, chest: ch });
        }

        // Player directional cyan/white arrow (real-time position & yaw)
        const pPt = projectWorldToRectMap(playerX, playerZ, worldBounds, widthPx, heightPx, 32);
        ctx.save();
        ctx.translate(pPt.x, pPt.y);
        ctx.rotate(-playerRotationY);

        ctx.beginPath();
        ctx.arc(0, 0, 12, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(34, 211, 238, 0.25)';
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(0, -10.5);
        ctx.lineTo(7.5, 7.5);
        ctx.lineTo(0, 3.8);
        ctx.lineTo(-7.5, 7.5);
        ctx.closePath();

        ctx.fillStyle = '#22d3ee';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.restore();
      }

      hitTargetsRef.current = hitTargets;
      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
    };
  }, [miniMapStateRef]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    let closest: MiniMapChestPoint | null = null;
    let bestDist = Infinity;
    for (const target of hitTargetsRef.current) {
      const dist = Math.hypot(cx - target.x, cy - target.y);
      if (dist <= target.r && dist < bestDist) {
        bestDist = dist;
        closest = target.chest;
      }
    }
    sounds.playClick();
    setSelectedChest(closest);
  };

  return (
    <div
      data-testid="full-map-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Peta Penuh Petualangan Pirate Academy"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/75 backdrop-blur-sm pointer-events-auto select-none"
      onClick={() => {
        sounds.playClick();
        onClose();
      }}
    >
      <div
        className="relative w-full max-w-4xl bg-slate-950/95 border-2 border-amber-500/70 rounded-2xl shadow-2xl overflow-hidden flex flex-col text-slate-100 max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 sm:px-5 sm:py-3.5 bg-gradient-to-r from-amber-950/90 via-slate-900 to-slate-950 border-b border-amber-500/35 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-400/60 flex items-center justify-center text-amber-300 shrink-0">
              <Compass className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="font-pirate text-base sm:text-xl font-bold text-amber-300 tracking-wide truncate">
                PETA PULAU HARTA KARUN
              </h2>
              <p className="text-[11px] text-slate-400 truncate">
                Pantau posisi Anda dan seluruh peti soal aktif di pulau ({completedCount}/{totalQuestions} selesai)
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              sounds.playClick();
              onClose();
            }}
            data-testid="close-full-map-btn"
            aria-label="Tutup Peta Penuh"
            className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-amber-500/40 text-amber-200 hover:text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
            <span className="hidden sm:inline">Tutup (Esc)</span>
          </button>
        </div>

        {/* Map Canvas + Compact Side Legend */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          {/* Interactive World Map Canvas */}
          <div
            ref={mapBoxRef}
            className="relative flex-1 min-h-[280px] h-[52vh] md:h-[500px] bg-slate-950 overflow-hidden"
          >
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              className="block w-full h-full cursor-crosshair"
            />
          </div>

          {/* Compact Legend & Selected Chest Info Panel */}
          <div className="w-full md:w-64 shrink-0 border-t md:border-t-0 md:border-l border-amber-500/25 bg-slate-900/75 p-4 flex flex-col justify-between gap-4 text-xs">
            <div className="space-y-4">
              <div>
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-amber-300 mb-2.5">
                  Legenda Peta
                </h3>
                <ul className="space-y-2 text-xs">
                  <li className="flex items-center gap-2.5">
                    <span className="w-3 h-3 rounded-full bg-red-500 border border-white shrink-0 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
                    <span className="text-slate-200">Merah = Belum dijawab</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <span className="w-3 h-3 rounded-full bg-emerald-500 border border-white shrink-0 shadow-[0_0_8px_rgba(34,197,94,0.75)]" />
                    <span className="text-slate-200">Hijau = Sudah dijawab</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <Navigation className="w-3.5 h-3.5 text-cyan-400 fill-cyan-400 shrink-0" />
                    <span className="text-slate-200">Cyan = Posisi Player</span>
                  </li>
                </ul>
              </div>

              {/* Selected Chest Informational Detail Card */}
              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  <span>Info Titik Peti</span>
                </div>
                {selectedChest ? (
                  <div className="space-y-1">
                    <div className="font-bold text-white">
                      Soal #{selectedChest.questionNumber}
                    </div>
                    <div className="text-[11px] text-slate-300">
                      {selectedChest.locationName || `Peti Soal #${selectedChest.questionNumber}`}
                    </div>
                    <div className="pt-1 flex items-center gap-1.5 font-semibold">
                      {selectedChest.completed ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Sudah dijawab
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-400">
                          <CircleDot className="w-3.5 h-3.5" />
                          Belum dijawab
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] font-mono text-slate-400">
                      Koordinat: X {selectedChest.x.toFixed(1)}m · Z {selectedChest.z.toFixed(1)}m
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Klik salah satu titik peti di peta untuk melihat nama lokasi dan nomor soalnya.
                  </p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                sounds.playClick();
                onClose();
              }}
              className="w-full py-2 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs cursor-pointer transition-colors"
            >
              Kembali ke Petualangan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
