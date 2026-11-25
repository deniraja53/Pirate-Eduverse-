/**
 * QuestMiniMap Component — Compact Pirate Adventure Circular Mini-Map (V10)
 * Features:
 * - Compact circular size (~100-112px desktop, responsive on mobile) beneath top-right settings buttons
 * - RED dots (#ef4444) for unanswered active chests, GREEN dots (#22c55e) for answered/completed chests
 * - Bright cyan/white directional arrow synced real-time to 3D player (X, Z) & yaw rotation
 * - Clickable to open the Full Pirate Quest Map modal
 * - Zero React re-render overhead: single Canvas 2D requestAnimationFrame loop cleanly cancelled on unmount
 * Created by Deni Raja99
 */

import React, { useEffect, useRef } from 'react';
import { Maximize2 } from 'lucide-react';
import { MiniMapLiveState, projectWorldToMiniMap } from '../game/MiniMapTypes';

interface QuestMiniMapProps {
  miniMapStateRef: React.MutableRefObject<MiniMapLiveState | null>;
  onOpenFullMap?: () => void;
}

export const QuestMiniMap: React.FC<QuestMiniMapProps> = ({
  miniMapStateRef,
  onOpenFullMap,
}) => {
  const containerRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let sizePx = container.clientWidth || 108;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    const applyCanvasSize = () => {
      const nextSize = Math.max(76, container.clientWidth || 108);
      const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
      sizePx = nextSize;
      dpr = nextDpr;
      canvas.width = Math.round(nextSize * nextDpr);
      canvas.height = Math.round(nextSize * nextDpr);
    };

    applyCanvasSize();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        applyCanvasSize();
      });
      resizeObserver.observe(container);
    }

    let rafId = 0;

    const renderFrame = (nowMs: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, sizePx, sizePx);

      const center = sizePx * 0.5;
      const outerR = center - 1.5;
      const usableR = Math.max(22, outerR - 7);

      // Circular clip boundary so all dots & player indicator stay cleanly inside
      ctx.save();
      ctx.beginPath();
      ctx.arc(center, center, outerR, 0, Math.PI * 2);
      ctx.clip();

      // Dark translucent ocean backdrop
      const bgGrad = ctx.createRadialGradient(center, center, 3, center, center, outerR);
      bgGrad.addColorStop(0, 'rgba(11, 38, 54, 0.62)');
      bgGrad.addColorStop(0.76, 'rgba(7, 23, 37, 0.72)');
      bgGrad.addColorStop(1, 'rgba(4, 14, 24, 0.82)');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, sizePx, sizePx);

      // Subtle concentric nautical radar rings
      ctx.strokeStyle = 'rgba(217, 179, 98, 0.16)';
      ctx.lineWidth = 0.85;
      [0.36, 0.7, 0.96].forEach((ratio) => {
        ctx.beginPath();
        ctx.arc(center, center, usableR * ratio, 0, Math.PI * 2);
        ctx.stroke();
      });

      // Faint compass crosshairs
      ctx.strokeStyle = 'rgba(217, 179, 98, 0.1)';
      ctx.beginPath();
      ctx.moveTo(center, 9);
      ctx.lineTo(center, sizePx - 9);
      ctx.moveTo(9, center);
      ctx.lineTo(sizePx - 9, center);
      ctx.stroke();

      // Tiny North indicator at top rim
      ctx.font = `700 ${Math.max(7.5, Math.round(sizePx * 0.072))}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(251, 191, 36, 0.75)';
      ctx.fillText('U', center, 2.5);

      const state = miniMapStateRef.current;
      if (state && state.ready) {
        const { worldBounds, chests, playerX, playerZ, playerRotationY } = state;

        // 1. Render active chest markers:
        //    - RED (#ef4444) = unanswered / not completed yet
        //    - GREEN (#22c55e) = answered / completed (regardless of right/wrong)
        for (let i = 0; i < chests.length; i++) {
          const ch = chests[i];
          if (!ch.active) continue;

          const pt = projectWorldToMiniMap(ch.x, ch.z, worldBounds, center, usableR);

          if (!ch.completed) {
            // Soft pulse ring for unanswered RED chests
            const pulse = 0.5 + 0.5 * Math.sin(nowMs * 0.0044 + i * 0.85);
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 3.6 + pulse * 1.9, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(239, 68, 68, ${0.26 - pulse * 0.14})`;
            ctx.fill();
          }

          ctx.beginPath();
          ctx.arc(pt.x, pt.y, ch.completed ? 2.4 : 2.8, 0, Math.PI * 2);
          ctx.fillStyle = ch.completed ? '#22c55e' : '#ef4444';
          ctx.fill();

          ctx.lineWidth = 0.85;
          ctx.strokeStyle = ch.completed
            ? 'rgba(6, 78, 59, 0.9)'
            : 'rgba(127, 29, 29, 0.95)';
          ctx.stroke();
        }

        // 2. Render Player directional indicator (bright cyan + crisp white outline)
        const pPt = projectWorldToMiniMap(playerX, playerZ, worldBounds, center, usableR);

        ctx.save();
        ctx.translate(pPt.x, pPt.y);
        ctx.rotate(-playerRotationY);

        ctx.beginPath();
        ctx.arc(0, 0, 5.8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(34, 211, 238, 0.25)';
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(0, -5.2);
        ctx.lineTo(3.8, 3.6);
        ctx.lineTo(0, 1.8);
        ctx.lineTo(-3.8, 3.6);
        ctx.closePath();

        ctx.fillStyle = '#22d3ee';
        ctx.fill();
        ctx.lineWidth = 1.15;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        ctx.restore();
      }

      ctx.restore();

      // Subtle inner gold bevel
      ctx.beginPath();
      ctx.arc(center, center, outerR, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(217, 179, 98, 0.28)';
      ctx.lineWidth = 1;
      ctx.stroke();

      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
    };
  }, [miniMapStateRef]);

  return (
    <button
      ref={containerRef}
      type="button"
      onClick={onOpenFullMap}
      data-testid="quest-minimap"
      aria-label="Buka Peta Petualangan Penuh"
      title="Klik untuk membuka Peta Penuh"
      className="group relative pointer-events-auto cursor-pointer select-none w-[86px] h-[86px] sm:w-[98px] sm:h-[98px] lg:w-[110px] lg:h-[110px] rounded-full overflow-hidden border border-amber-500/55 hover:border-amber-300 bg-[#0b1422]/75 shadow-[0_6px_18px_rgba(0,0,0,0.52)] transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-amber-400/60"
      style={{ borderRadius: '50%' }}
    >
      <canvas ref={canvasRef} className="block w-full h-full pointer-events-none" />
      {/* Subtle expand hint badge on hover */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-1.5 right-1.5 w-4 h-4 rounded-full bg-slate-950/80 border border-amber-400/60 text-amber-300 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Maximize2 className="w-2.5 h-2.5" />
      </span>
    </button>
  );
};
