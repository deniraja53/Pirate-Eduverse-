/**
 * Third-person Orbiting Camera Controller
 * Smoothly follows player with mouse/touch drag rotation and ground-clearance checks
 */

import * as THREE from 'three';

export class CameraController {
  public camera: THREE.PerspectiveCamera;
  public yaw: number = 0; // horizontal angle
  public pitch: number = 0.35; // vertical angle (radians)
  public distance: number = 6.8;
  public targetOffset: THREE.Vector3 = new THREE.Vector3(0, 1.4, 0);

  private currentPosition: THREE.Vector3 = new THREE.Vector3();
  private currentLookAt: THREE.Vector3 = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  public update(playerPos: THREE.Vector3, delta: number) {
    // Desired look at point
    const targetLookAt = playerPos.clone().add(this.targetOffset);

    // Compute ideal camera position in spherical coordinates relative to player
    const horizontalDist = this.distance * Math.cos(this.pitch);
    const verticalDist = this.distance * Math.sin(this.pitch);

    const idealX = playerPos.x - Math.sin(this.yaw) * horizontalDist;
    const idealZ = playerPos.z - Math.cos(this.yaw) * horizontalDist;
    let idealY = playerPos.y + this.targetOffset.y + verticalDist;

    // Keep camera above ground + 0.8 min
    idealY = Math.max(idealY, playerPos.y + 1.0);

    const targetPos = new THREE.Vector3(idealX, idealY, idealZ);

    // Frame-rate independent exponential damping
    this.currentPosition.x = THREE.MathUtils.damp(this.currentPosition.x, targetPos.x, 10, delta);
    this.currentPosition.y = THREE.MathUtils.damp(this.currentPosition.y, targetPos.y, 10, delta);
    this.currentPosition.z = THREE.MathUtils.damp(this.currentPosition.z, targetPos.z, 10, delta);

    this.currentLookAt.x = THREE.MathUtils.damp(this.currentLookAt.x, targetLookAt.x, 12, delta);
    this.currentLookAt.y = THREE.MathUtils.damp(this.currentLookAt.y, targetLookAt.y, 12, delta);
    this.currentLookAt.z = THREE.MathUtils.damp(this.currentLookAt.z, targetLookAt.z, 12, delta);

    this.camera.position.copy(this.currentPosition);
    this.camera.lookAt(this.currentLookAt);
  }

  /**
   * Rotate camera around player
   */
  public rotate(deltaYaw: number, deltaPitch: number) {
    this.yaw -= deltaYaw;
    this.pitch = Math.max(0.12, Math.min(Math.PI / 2.6, this.pitch - deltaPitch));
  }
}
