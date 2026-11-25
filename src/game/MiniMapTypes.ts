/**
 * Tactical Mini-Map & Full Map Live Telemetry Types & World-to-2D Projection Helpers
 * Connects directly to 3D CharacterController & GLB-validated TreasureChest coordinates.
 * Created by Deni Raja99
 */

export interface MiniMapChestPoint {
  chestId: string;
  questionId: string;
  questionNumber: number;
  locationName?: string;
  x: number;
  z: number;
  active: boolean;
  completed: boolean; // true once student's answer is persisted (whether right or wrong)
  locked: boolean;
}

export interface MiniMapWorldBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface MiniMapLiveState {
  playerX: number;
  playerZ: number;
  playerRotationY: number;
  worldBounds: MiniMapWorldBounds;
  chests: MiniMapChestPoint[];
  ready: boolean;
}

/**
 * Matches the actual playable world boundaries in MapEnvironment.ts (Z: 1.5..778, X: -134..134)
 * centered horizontally around the coastal island corridor so Start, Chests, Bridge, and Finish Ship
 * fit proportionately with uniform 1:1 scale.
 */
export const DEFAULT_PLAYABLE_WORLD_BOUNDS: MiniMapWorldBounds = {
  minX: -115,
  maxX: 65,
  minZ: 0,
  maxZ: 780,
};

export function createInitialMiniMapState(): MiniMapLiveState {
  return {
    playerX: 0,
    playerZ: 4,
    playerRotationY: 0,
    worldBounds: { ...DEFAULT_PLAYABLE_WORLD_BOUNDS },
    chests: [],
    ready: false,
  };
}

export interface ProjectedPoint {
  x: number;
  y: number;
}

/**
 * Projects 3D world (X, Z) coordinates into 2D circular canvas coordinates (px).
 * Uses uniform 1:1 world scale aligned with PirateGameCanvas camera axes:
 *   - Up on canvas (-dy) = +Z (Start -> Finish)
 *   - Right on canvas (+dx) = -X (matching _camRight = (+Z) x (+Y) = (-1, 0, 0))
 * Clamps safely inside usableRadiusPx so no point ever clips outside the circular ring border.
 */
export function projectWorldToMiniMap(
  worldX: number,
  worldZ: number,
  bounds: MiniMapWorldBounds,
  centerPx: number,
  usableRadiusPx: number
): ProjectedPoint {
  const centerX = (bounds.minX + bounds.maxX) * 0.5;
  const centerZ = (bounds.minZ + bounds.maxZ) * 0.5;
  const halfSpanX = Math.max(40, (bounds.maxX - bounds.minX) * 0.5);
  const halfSpanZ = Math.max(40, (bounds.maxZ - bounds.minZ) * 0.5);

  const worldHalfSpan = Math.max(halfSpanX, halfSpanZ) * 1.06;
  const scale = usableRadiusPx / worldHalfSpan;

  let dx = (centerX - worldX) * scale;
  let dy = (centerZ - worldZ) * scale;

  const dist = Math.hypot(dx, dy);
  const maxR = Math.max(1, usableRadiusPx - 2.0);
  if (dist > maxR) {
    const ratio = maxR / dist;
    dx *= ratio;
    dy *= ratio;
  }

  return {
    x: centerPx + dx,
    y: centerPx + dy,
  };
}

/**
 * Projects 3D world (X, Z) coordinates into a rectangular Full Map canvas (px)
 * using the exact same world orientation (+Z = Up, -X = Right) and uniform 1:1 scale
 * as the circular mini-map so both views are 100% geometrically consistent.
 */
export function projectWorldToRectMap(
  worldX: number,
  worldZ: number,
  bounds: MiniMapWorldBounds,
  widthPx: number,
  heightPx: number,
  paddingPx: number = 28
): ProjectedPoint {
  const centerX = (bounds.minX + bounds.maxX) * 0.5;
  const centerZ = (bounds.minZ + bounds.maxZ) * 0.5;
  const spanX = Math.max(80, bounds.maxX - bounds.minX);
  const spanZ = Math.max(80, bounds.maxZ - bounds.minZ);

  const availW = Math.max(40, widthPx - paddingPx * 2);
  const availH = Math.max(40, heightPx - paddingPx * 2);
  const scale = Math.min(availW / spanX, availH / spanZ);

  const rawX = widthPx * 0.5 + (centerX - worldX) * scale;
  const rawY = heightPx * 0.5 + (centerZ - worldZ) * scale;

  return {
    x: Math.max(paddingPx * 0.5, Math.min(widthPx - paddingPx * 0.5, rawX)),
    y: Math.max(paddingPx * 0.5, Math.min(heightPx - paddingPx * 0.5, rawY)),
  };
}
