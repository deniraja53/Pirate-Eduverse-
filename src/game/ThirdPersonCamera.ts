/**
 * ThirdPersonCamera Controller
 * True third-person camera rig with smooth exponential damping,
 * separate look-at focus interpolation, mouse orbit, and ground-clearance checks.
 * Created by Deni Raja99
 */

import * as THREE from 'three';
import { GameConfig } from './GameConfig';

export class ThirdPersonCamera {
  public camera: THREE.PerspectiveCamera;
  public config: GameConfig;

  // Camera angles
  public yaw: number = 0; // Horizontal orbit angle (radians)
  public pitch: number = 0.28; // Vertical elevation angle (radians)

  // Smoothed internal positions
  public currentPosition: THREE.Vector3 = new THREE.Vector3();
  public currentLookAt: THREE.Vector3 = new THREE.Vector3();

  // Reusable scratch vectors to avoid per-frame GC allocations
  private _targetLookAt: THREE.Vector3 = new THREE.Vector3();
  private _idealPosition: THREE.Vector3 = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, config: GameConfig) {
    this.camera = camera;
    this.config = config;
    this.pitch = config.cameraPitch;
  }

  /**
   * Initialize camera immediately behind character without initial jump
   */
  public resetToCharacter(characterPos: THREE.Vector3) {
    const focusY = characterPos.y + this.config.targetCharacterHeight * 0.75;
    this.currentLookAt.set(characterPos.x, focusY, characterPos.z);

    const hDist = this.config.cameraDistance * Math.cos(this.pitch);
    const vDist = this.config.cameraDistance * Math.sin(this.pitch) + this.config.cameraHeight;

    const idealX = characterPos.x - Math.sin(this.yaw) * hDist;
    const idealY = characterPos.y + vDist;
    const idealZ = characterPos.z - Math.cos(this.yaw) * hDist;

    this.currentPosition.set(idealX, idealY, idealZ);
    this.camera.position.copy(this.currentPosition);
    this.camera.lookAt(this.currentLookAt);
  }

  /**
   * Main camera update loop called per frame
   */
  public update(characterPos: THREE.Vector3, dt: number, minGroundY: number = -999) {
    if (dt <= 0) return;
    const clampedDt = Math.min(dt, 0.1);

    // 1. Calculate ideal look-at target (chest/head height of character)
    const targetFocusY = characterPos.y + this.config.targetCharacterHeight * 0.72;
    this._targetLookAt.set(characterPos.x, targetFocusY, characterPos.z);

    // Exponential damping for look-at target
    const lookAtDamp = 1 - Math.exp(-this.config.lookAtDamping * clampedDt);
    this.currentLookAt.lerp(this._targetLookAt, lookAtDamp);

    // 2. Compute ideal camera position based on yaw and pitch angles
    const hDist = this.config.cameraDistance * Math.cos(this.pitch);
    const vDist = this.config.cameraDistance * Math.sin(this.pitch) + this.config.cameraHeight;

    const idealX = characterPos.x - Math.sin(this.yaw) * hDist;
    let idealY = characterPos.y + vDist;
    const idealZ = characterPos.z - Math.cos(this.yaw) * hDist;

    // Prevent camera from dipping beneath terrain floor
    const safeMinY = Math.max(minGroundY + 0.6, characterPos.y + 0.6);
    idealY = Math.max(idealY, safeMinY);

    this._idealPosition.set(idealX, idealY, idealZ);

    // Exponential damping for camera position (frame-rate independent)
    const posDamp = 1 - Math.exp(-this.config.cameraDamping * clampedDt);
    this.currentPosition.lerp(this._idealPosition, posDamp);

    // 3. Apply to Three.js camera
    this.camera.position.copy(this.currentPosition);
    this.camera.lookAt(this.currentLookAt);
  }

  /**
   * Rotate camera yaw and pitch via mouse or touch drag
   */
  public rotate(deltaX: number, deltaY: number) {
    const sens = this.config.mouseSensitivity;
    this.yaw -= deltaX * sens;

    // Clamp pitch between shallow 5 degrees and top-down 68 degrees
    const minPitch = 0.08;
    const maxPitch = 1.15;
    this.pitch = Math.max(minPitch, Math.min(maxPitch, this.pitch - deltaY * sens));
  }
}
