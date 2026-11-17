/**
 * Tactical Mini-Map Live Telemetry Types & World-to-2D Projection Helpers
 * Connects directly to 3D CharacterController & GLB-validated TreasureChest coordinates.
 * Created by Deni Raja99
 */

export interface MiniMapChestPoint {
  chestId: string;
  questionId: string;
  questionNumber: number;
  x: number;
  z: number;
  active: boolean;
  completed: boolean;
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
 * Clamps safely inside usableRadiusPx so no point ever clips outside the ring border.
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

  // Uniform circular world radius guaranteeing full corridor visibility without axis distortion
  const worldHalfSpan = Math.max(halfSpanX, halfSpanZ) * 1.06;
  const scale = usableRadiusPx / worldHalfSpan;

  let dx = (centerX - worldX) * scale;
  let dy = (centerZ - worldZ) * scale;

  // Clamp strictly inside circular safe radius
  const dist = Math.hypot(dx, dy);
  const maxR = Math.max(1, usableRadiusPx - 2.5);
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
