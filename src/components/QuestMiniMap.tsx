/**
 * QuestMiniMap Component — Pirate Adventure Tactical Circular Mini-Map
 * Features:
 * - Perfect circular clipping (rounded-full overflow-hidden)
 * - Positioned beneath top-right HUD settings buttons with pointer-events-none
 * - Reads live mutable 3D telemetry ref via a single requestAnimationFrame loop (zero React re-renders)
 * - Displays directional cyan/white player arrow, pulsing gold dots for uncompleted chests,
 *   and gentle fade-out when chests are completed.
 * Created by Deni Raja99
 */

import React, { useEffect, useRef } from 'react';
import { MiniMapLiveState, projectWorldToMiniMap } from '../game/MiniMapTypes';

interface QuestMiniMapProps {
  miniMapStateRef: React.MutableRefObject<MiniMapLiveState | null>;
}

export const QuestMiniMap: React.FC<QuestMiniMapProps> = ({ miniMapStateRef }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let sizePx = container.clientWidth || 148;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    const applyCanvasSize = () => {
      const nextSize = Math.max(96, container.clientWidth || 148);
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

    // Track recently completed chests for smooth 420ms fade-out animation
    const prevCompletedMap = new Map<string, boolean>();
    const fadeOutStartMsMap = new Map<string, number>();

    let rafId = 0;

    const renderFrame = (nowMs: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, sizePx, sizePx);

      const center = sizePx * 0.5;
      const outerR = center - 1.5;
      const usableR = Math.max(24, outerR - 10);

      // Circular clip boundary so nothing ever bleeds outside the circle
      ctx.save();
      ctx.beginPath();
      ctx.arc(center, center, outerR, 0, Math.PI * 2);
      ctx.clip();

      // Subtle nautical dark ocean radar gradient backdrop
      const bgGrad = ctx.createRadialGradient(center, center, 4, center, center, outerR);
      bgGrad.addColorStop(0, 'rgba(13, 39, 54, 0.58)');
      bgGrad.addColorStop(0.75, 'rgba(8, 24, 38, 0.68)');
      bgGrad.addColorStop(1, 'rgba(4, 14, 24, 0.78)');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, sizePx, sizePx);

      // Concentric tactical radar rings
      ctx.strokeStyle = 'rgba(217, 179, 98, 0.14)';
      ctx.lineWidth = 1;
      [0.34, 0.67, 0.94].forEach((ratio) => {
        ctx.beginPath();
        ctx.arc(center, center, usableR * ratio, 0, Math.PI * 2);
        ctx.stroke();
      });

      // Subtle compass crosshairs
      ctx.strokeStyle = 'rgba(217, 179, 98, 0.1)';
      ctx.beginPath();
      ctx.moveTo(center, 12);
      ctx.lineTo(center, sizePx - 16);
      ctx.moveTo(12, center);
      ctx.lineTo(sizePx - 12, center);
      ctx.stroke();

      // Tiny cardinal North (U) indicator at top rim
      ctx.font = `700 ${Math.max(8, Math.round(sizePx * 0.06))}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(251, 191, 36, 0.72)';
      ctx.fillText('U', center, 4);

      const state = miniMapStateRef.current;
      if (state && state.ready) {
        const { worldBounds, chests, playerX, playerZ, playerRotationY } = state;

        // 1. Render active chest markers (uncompleted pulsing gold, fade-out on completion)
        for (let i = 0; i < chests.length; i++) {
          const ch = chests[i];
          if (!ch.active) continue;

          const wasCompleted = prevCompletedMap.get(ch.questionId);
          if (wasCompleted === false && ch.completed) {
            fadeOutStartMsMap.set(ch.questionId, nowMs);
          } else if (!ch.completed) {
            fadeOutStartMsMap.delete(ch.questionId);
          }
          prevCompletedMap.set(ch.questionId, ch.completed);

          let alpha = 1;
          let scaleFactor = 1;

          if (ch.completed) {
            const fadeStart = fadeOutStartMsMap.get(ch.questionId);
            if (fadeStart === undefined) {
              continue; // Completed chests stay removed from map
            }
            const progress = (nowMs - fadeStart) / 420;
            if (progress >= 1) {
              fadeOutStartMsMap.delete(ch.questionId);
              continue;
            }
            alpha = Math.max(0, 1 - progress);
            scaleFactor = 1 - progress * 0.55;
          }

          const pt = projectWorldToMiniMap(ch.x, ch.z, worldBounds, center, usableR);

          if (!ch.completed && !ch.locked) {
            // Subtle pulsing gold aura for active uncompleted chests
            const pulse = 0.5 + 0.5 * Math.sin(nowMs * 0.0042 + i * 0.9);
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, (4.2 + pulse * 2.4) * scaleFactor, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(250, 204, 21, ${(0.22 - pulse * 0.12) * alpha})`;
            ctx.fill();
          }

          // Chest point dot
          const dotR = (ch.locked ? 2.4 : 3.1) * scaleFactor;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, dotR, 0, Math.PI * 2);
          ctx.fillStyle = ch.completed
            ? `rgba(52, 211, 153, ${alpha})`
            : ch.locked
            ? `rgba(245, 158, 11, ${0.48 * alpha})`
            : `rgba(250, 204, 21, ${0.98 * alpha})`;
          ctx.fill();

          if (!ch.locked) {
            ctx.lineWidth = 0.9;
            ctx.strokeStyle = `rgba(15, 23, 42, ${0.8 * alpha})`;
            ctx.stroke();
          }
        }

        // 2. Render directional Player indicator (bright cyan + crisp white edge)
        const pPt = projectWorldToMiniMap(playerX, playerZ, worldBounds, center, usableR);

        ctx.save();
        ctx.translate(pPt.x, pPt.y);
        // -playerRotationY matches canvas UP (+Z) & canvas RIGHT (-X)
        ctx.rotate(-playerRotationY);

        // Soft cyan glow behind player arrow
        ctx.beginPath();
        ctx.arc(0, 0, 7.2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(34, 211, 238, 0.24)';
        ctx.fill();

        // Directional chevron/arrow pointing forward
        ctx.beginPath();
        ctx.moveTo(0, -6.4);
        ctx.lineTo(4.6, 4.4);
        ctx.lineTo(0, 2.2);
        ctx.lineTo(-4.6, 4.4);
        ctx.closePath();

        ctx.fillStyle = '#22d3ee';
        ctx.fill();
        ctx.lineWidth = 1.25;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        ctx.restore();
      }

      // Tiny unobtrusive QUEST MAP label at bottom inside rim
      ctx.font = `700 ${Math.max(7.5, Math.round(sizePx * 0.052))}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(253, 230, 138, 0.58)';
      ctx.fillText('QUEST MAP', center, sizePx - 4.5);

      ctx.restore();

      // Subtle inner bevel ring
      ctx.beginPath();
      ctx.arc(center, center, outerR, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(217, 179, 98, 0.25)';
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
    <div
      ref={containerRef}
      data-testid="quest-minimap"
      aria-hidden="true"
      className="pointer-events-none select-none w-[112px] h-[112px] sm:w-[136px] sm:h-[136px] lg:w-[152px] lg:h-[152px] rounded-full overflow-hidden border border-amber-500/45 bg-slate-950/55 backdrop-blur-xs shadow-[0_8px_24px_rgba(0,0,0,0.52)]"
      style={{ borderRadius: '50%' }}
    >
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
};
