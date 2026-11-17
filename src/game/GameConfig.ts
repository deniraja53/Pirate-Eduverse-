/**
 * Configurable parameters for Third-Person Character Controller, Map, and Camera
 * Created for Pirate Academy: Treasure Quest - Deni Raja99
 */

export interface GameConfig {
  // Character dimensions & scaling
  targetCharacterHeight: number; // In world units/meters (e.g. 1.8m)
  characterScale: number; // Derived or manual multiplier
  spawnPosition: { x: number; y: number; z: number };

  // Movement physics
  movementSpeed: number; // Max walk/run speed (units/sec)
  rotationSpeed: number; // Turn smoothing speed
  acceleration: number; // Speed ramp-up rate
  deceleration: number; // Friction / stopping rate
  jumpForce: number;
  gravity: number;

  // Third-person Camera Rig
  cameraDistance: number; // Distance behind character
  cameraHeight: number; // Elevation above character's head
  cameraPitch: number; // Vertical angle (radians)
  cameraDamping: number; // Smoothing factor for camera position
  lookAtDamping: number; // Smoothing factor for camera target
  mouseSensitivity: number; // Sensitivity for mouse rotation

  // Model Asset Paths
  mapGlbPath: string;
  characterGlbPath: string;
  mapScale: number;

  // Collision & Boundary Physics
  playerColliderRadius: number;
  playerColliderHeight: number;
  playerStepHeight: number;
  maxWalkableSlope: number;
  waterLevelY: number;
  maxSubstepDistance: number;

  // Diagnostics & Debug mode
  debugMode: boolean;
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
  targetCharacterHeight: 1.8,
  characterScale: 0.71, // 1.8 / 2.535588
  spawnPosition: { x: 0, y: 0.0, z: 4.0 },

  movementSpeed: 7.5,
  rotationSpeed: 14.0,
  acceleration: 18.0,
  deceleration: 22.0,
  jumpForce: 7.0,
  gravity: 20.0,

  cameraDistance: 5.4,
  cameraHeight: 2.1,
  cameraPitch: 0.28,
  cameraDamping: 9.0,
  lookAtDamping: 14.0,
  mouseSensitivity: 0.0035,

  mapGlbPath: '/assets/models/game_pirate_adventure_map.glb',
  characterGlbPath: '/assets/models/karakter edgar.glb',
  mapScale: 0.01, // 1 cm in model = 1 meter in Three.js world

  playerColliderRadius: 0.36,
  playerColliderHeight: 1.75,
  playerStepHeight: 0.65,
  maxWalkableSlope: 0.48,
  waterLevelY: -0.95,
  maxSubstepDistance: 0.22,

  debugMode: false,
};
