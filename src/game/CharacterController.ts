/**
 * Third-Person Character Controller
 * Loads karakter edgar.glb, decouples fixed physics capsule collider from visual animation bones,
 * runs FPS-independent substepped horizontal obstacle & boundary sliding collision,
 * and handles smooth acceleration/deceleration, shortest-angle rotation, and AnimationMixer.
 * Created by Deni Raja99
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GameConfig } from './GameConfig';
import { ChestCollisionVolume, MapEnvironment } from './MapEnvironment';

export interface CharacterDiagnostics {
  status: 'loading' | 'loaded' | 'error';
  path: string;
  originalHeight: number;
  appliedScale: number;
  finalHeight: number;
  animationClips: string[];
  activeAction?: string;
  message: string;
}

export class CharacterController {
  // Main controller group (handles physics position in world, decoupled from animated visual bones)
  public group: THREE.Group;

  // Visual model group (handles character rotation and visual animation)
  public visualGroup: THREE.Group;

  // Developer-only wireframe capsule showing exact fixed physics collider
  private debugColliderGroup: THREE.Group;
  private debugCapsuleMesh: THREE.Mesh;

  public config: GameConfig;
  public mapEnv: MapEnvironment;
  public diagnostics: CharacterDiagnostics;

  // Motion physics state
  public velocity: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  public currentSpeed: number = 0;
  public targetRotationY: number = 0;
  public currentRotationY: number = 0;
  public isGrounded: boolean = true;
  public verticalVelocity: number = 0;
  public isMoving: boolean = false;

  // Animation system
  private mixer: THREE.AnimationMixer | null = null;
  private actionClip: THREE.AnimationAction | null = null;
  private loadedModel: THREE.Object3D | null = null;

  constructor(config: GameConfig, mapEnv: MapEnvironment) {
    this.config = config;
    this.mapEnv = mapEnv;

    // Physics root group
    this.group = new THREE.Group();
    this.group.position.set(
      config.spawnPosition.x,
      config.spawnPosition.y,
      config.spawnPosition.z
    );

    // Visual model container
    this.visualGroup = new THREE.Group();
    this.group.add(this.visualGroup);

    // Fixed upright Capsule Collider visualizer (hidden unless debugMode === true)
    this.debugColliderGroup = new THREE.Group();
    this.debugColliderGroup.visible = Boolean(config.debugMode);
    this.group.add(this.debugColliderGroup);

    const r = config.playerColliderRadius || 0.36;
    const h = config.playerColliderHeight || 1.75;
    const cylLen = Math.max(0.2, h - r * 2);
    const capsuleGeo = new THREE.CapsuleGeometry(r, cylLen, 4, 14);
    const capsuleMat = new THREE.MeshBasicMaterial({
      color: 0x06b6d4,
      wireframe: true,
      transparent: true,
      opacity: 0.9,
    });
    this.debugCapsuleMesh = new THREE.Mesh(capsuleGeo, capsuleMat);
    this.debugCapsuleMesh.position.y = h * 0.5;
    this.debugColliderGroup.add(this.debugCapsuleMesh);

    this.diagnostics = {
      status: 'loading',
      path: config.characterGlbPath,
      originalHeight: 0,
      appliedScale: 1,
      finalHeight: 0,
      animationClips: [],
      message: 'Memuat karakter Edgar 3D...',
    };
  }

  /**
   * Toggle developer debug wireframe visibility for the player capsule collider
   */
  public setDebugMode(enabled: boolean) {
    this.debugColliderGroup.visible = enabled;
  }

  /**
   * Load the character GLB file (karakter edgar.glb)
   */
  public loadCharacter(
    onSuccess?: () => void,
    onError?: (err: Error) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const loader = new GLTFLoader();

      // Safely encode filename with spaces (e.g. /assets/models/karakter%20edgar.glb)
      const encodedPath = encodeURI(this.config.characterGlbPath);

      loader.load(
        encodedPath,
        (gltf) => {
          this.loadedModel = gltf.scene;

          // 1. Analyze raw character bounding box
          const rawBox = new THREE.Box3().setFromObject(this.loadedModel);
          const rawSize = new THREE.Vector3();
          rawBox.getSize(rawSize);

          const rawHeight = rawSize.y > 0 ? rawSize.y : 2.535;
          this.diagnostics.originalHeight = Number(rawHeight.toFixed(3));

          // 2. Compute proportional scale so visual character height matches targetCharacterHeight (1.8m)
          const targetHeight = this.config.targetCharacterHeight;
          const scale = targetHeight / rawHeight;
          this.config.characterScale = scale;

          this.diagnostics.appliedScale = Number(scale.toFixed(4));
          this.diagnostics.finalHeight = Number((rawHeight * scale).toFixed(2));

          // Scale visual model without changing fixed physics capsule collider
          this.loadedModel.scale.set(scale, scale, scale);

          // Align feet: Offset visual model so bottom sits cleanly at Y = 0
          const scaledMinY = rawBox.min.y * scale;
          this.loadedModel.position.y = -scaledMinY;

          // Shadow and material configuration
          this.loadedModel.traverse((node) => {
            if ((node as THREE.Mesh).isMesh) {
              const mesh = node as THREE.Mesh;
              mesh.castShadow = true;
              mesh.receiveShadow = true;
            }
          });

          this.visualGroup.add(this.loadedModel);

          // 3. Setup AnimationMixer for animation clips
          if (gltf.animations && gltf.animations.length > 0) {
            this.mixer = new THREE.AnimationMixer(this.loadedModel);
            this.diagnostics.animationClips = gltf.animations.map((a) => a.name);

            const clip = gltf.animations[0];
            this.actionClip = this.mixer.clipAction(clip);
            this.actionClip.setLoop(THREE.LoopRepeat, Infinity);
            this.actionClip.play();
            this.actionClip.paused = true;
            this.diagnostics.activeAction = clip.name;
          }

          // Contact shadow plane directly beneath feet
          const shadowGeo = new THREE.CircleGeometry(0.55, 24);
          const shadowMat = new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0.35,
            depthWrite: false,
          });
          const contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
          contactShadow.rotation.x = -Math.PI / 2;
          contactShadow.position.y = 0.02;
          this.visualGroup.add(contactShadow);

          this.diagnostics.status = 'loaded';
          this.diagnostics.message = `Karakter Edgar berhasil dimuat! Tinggi: ${this.diagnostics.finalHeight}m (Skala: ${scale.toFixed(2)})`;

          if (onSuccess) onSuccess();
          resolve();
        },
        undefined,
        (err) => {
          console.error('Error loading character GLB:', err);
          this.diagnostics.status = 'error';
          this.diagnostics.message = `Gagal memuat karakter (${this.config.characterGlbPath}): ${(err as Error).message}`;
          if (onError) onError(err as Error);
          reject(err);
        }
      );
    });
  }

  /**
   * Helper: Angle difference wrapped to [-PI, PI] to prevent 360-degree spin
   */
  private shortestAngleDifference(fromAngle: number, toAngle: number): number {
    let diff = (toAngle - fromAngle) % (Math.PI * 2);
    if (diff < -Math.PI) diff += Math.PI * 2;
    if (diff > Math.PI) diff -= Math.PI * 2;
    return diff;
  }

  /**
   * Main movement, substepped collision resolution, and animation physics update.
   * Called every frame with delta time (dt in seconds).
   */
  public update(
    dt: number,
    inputDirection: { x: number; z: number } | null,
    wantsJump: boolean,
    chestColliders: ChestCollisionVolume[] = []
  ) {
    if (dt <= 0) return;
    const clampedDt = Math.min(dt, 0.1);

    // 1. Horizontal Acceleration / Deceleration
    const hasInput =
      inputDirection !== null &&
      (Math.abs(inputDirection.x) > 0.05 || Math.abs(inputDirection.z) > 0.05);

    if (hasInput && inputDirection) {
      this.isMoving = true;
      const targetSpeed = this.config.movementSpeed;
      const targetVelX = inputDirection.x * targetSpeed;
      const targetVelZ = inputDirection.z * targetSpeed;

      const accelRate = this.config.acceleration * clampedDt;
      this.velocity.x = THREE.MathUtils.damp(this.velocity.x, targetVelX, accelRate, 1);
      this.velocity.z = THREE.MathUtils.damp(this.velocity.z, targetVelZ, accelRate, 1);

      this.targetRotationY = Math.atan2(inputDirection.x, inputDirection.z);
    } else {
      this.isMoving = false;
      const decelRate = this.config.deceleration * clampedDt;
      this.velocity.x = THREE.MathUtils.damp(this.velocity.x, 0, decelRate, 1);
      this.velocity.z = THREE.MathUtils.damp(this.velocity.z, 0, decelRate, 1);
    }

    // Visual facing rotation based on intended input direction (smooth & never jitters against walls)
    const rawSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (rawSpeed > 0.15) {
      const angleDiff = this.shortestAngleDifference(this.currentRotationY, this.targetRotationY);
      this.currentRotationY += angleDiff * (1 - Math.exp(-this.config.rotationSpeed * clampedDt));
      this.visualGroup.rotation.y = this.currentRotationY;
    }

    // 2. FPS-Independent Substepped Horizontal Collision Resolution (Zero Tunneling Guarantee)
    const totalDisp = rawSpeed * clampedDt;
    const maxStep = Math.max(0.08, this.config.maxSubstepDistance || 0.22);
    const numSubsteps = Math.max(1, Math.min(10, Math.ceil(totalDisp / maxStep)));
    const subDt = clampedDt / numSubsteps;

    let targetGroundY = this.group.position.y;
    let isOnBridge = false;

    for (let step = 0; step < numSubsteps; step++) {
      const desiredX = this.group.position.x + this.velocity.x * subDt;
      const desiredZ = this.group.position.z + this.velocity.z * subDt;

      const resolved = this.mapEnv.resolveCapsuleMovement(
        this.group.position,
        desiredX,
        desiredZ,
        this.velocity,
        chestColliders
      );

      this.group.position.x = resolved.x;
      this.group.position.z = resolved.z;
      targetGroundY = resolved.groundY;
      isOnBridge = resolved.isOnBridge;

      // Update debug capsule color tint on active collision or shoreline boundary
      if (this.debugColliderGroup.visible) {
        const mat = this.debugCapsuleMesh.material as THREE.MeshBasicMaterial;
        if (resolved.hitBoundary) {
          mat.color.setHex(0xef4444); // Red: water/chasm/map boundary
        } else if (resolved.collidedObstacle) {
          mat.color.setHex(0xf97316); // Orange: solid obstacle contact
        } else {
          mat.color.setHex(0x06b6d4); // Cyan: clear walkable movement
        }
      }
    }

    this.currentSpeed = Math.hypot(this.velocity.x, this.velocity.z);

    // 3. Jump & Vertical Grounding Physics
    if (wantsJump && this.isGrounded) {
      this.verticalVelocity = this.config.jumpForce;
      this.isGrounded = false;
    }

    if (!this.isGrounded) {
      this.verticalVelocity -= this.config.gravity * clampedDt;
      this.group.position.y += this.verticalVelocity * clampedDt;

      if (this.group.position.y <= targetGroundY) {
        this.group.position.y = targetGroundY;
        this.verticalVelocity = 0;
        this.isGrounded = true;
      }
    } else {
      // Smooth ground-height following across terrain dunes, road shoulders, and bridge planks
      this.group.position.y = THREE.MathUtils.damp(
        this.group.position.y,
        targetGroundY,
        24,
        clampedDt
      );

      if (targetGroundY - this.group.position.y < -1.8 && !isOnBridge) {
        this.isGrounded = false;
        this.verticalVelocity = 0;
      }
    }

    // Safety net respawn ONLY if external glitch ever puts character below -20m
    if (this.group.position.y < -20) {
      this.respawn();
    }

    // 4. Update Animation Mixer
    if (this.mixer) {
      const animSpeed = hasInput ? Math.max(this.currentSpeed, 0.35) : this.currentSpeed;
      if (animSpeed > 0.3 && (hasInput || this.currentSpeed > 0.4)) {
        if (this.actionClip) {
          this.actionClip.paused = false;
          const speedRatio = Math.min(1.5, animSpeed / this.config.movementSpeed);
          this.actionClip.timeScale = 1.0 + speedRatio * 0.8;
        }
      } else {
        if (this.actionClip) {
          this.actionClip.paused = true;
        }
      }
      this.mixer.update(clampedDt);
    }
  }

  /**
   * Respawn character at safe starting coordinates
   */
  public respawn() {
    this.group.position.set(
      this.config.spawnPosition.x,
      this.config.spawnPosition.y,
      this.config.spawnPosition.z
    );
    this.velocity.set(0, 0, 0);
    this.verticalVelocity = 0;
    this.isGrounded = true;
  }
}
