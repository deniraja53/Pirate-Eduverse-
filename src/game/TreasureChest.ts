/**
 * 3D Interactive Treasure Chest Model for Pirate Academy (V10 Juicy VFX)
 * Uses public/assets/models/box.glb (ornate treasure chest with hinged lid node 'Empty_82')
 * Features:
 * - Smooth eased hinged lid opening/closing (Empty_82 pivot at rear hinge, safe fallback if absent)
 * - Warm #FFD45A interior golden glow sprite (no heavy dynamic PointLights)
 * - Pre-allocated pool of 12 rising golden sparkle particles (850-1250ms, zero per-trigger allocation)
 * - Pre-allocated pool of 7 spinning parabolic gold coins on confirmed correct answers ONLY (950-1300ms)
 * - Question Number Badge, Magical Beacon Light, Completion Star, and clean resource disposal
 * Created by Deni Raja99
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ChestPlacementMeta, ChestZoneType, Question } from '../types/game';

THREE.Cache.enabled = true;

const LID_CLOSED_ANGLE = 0.0;
const LID_OPEN_ANGLE = -1.14;
const LID_COMPLETED_ANGLE = -0.82;
const SPARKLE_POOL_SIZE = 12;
const COIN_POOL_SIZE = 7;

// Shared GLTF model & reusable geometry/texture caches (prevent redundant allocations)
let cachedBoxTemplate: THREE.Object3D | null = null;
let boxLoadingPromise: Promise<THREE.Object3D> | null = null;
let sharedBeamGeo: THREE.CylinderGeometry | null = null;
let sharedStarGeo: THREE.ExtrudeGeometry | null = null;
let sharedStarMaterial: THREE.MeshStandardMaterial | null = null;
let sharedCoinGeo: THREE.CylinderGeometry | null = null;
let sharedGlowTexture: THREE.CanvasTexture | null = null;
let sharedSparkleTexture: THREE.CanvasTexture | null = null;

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function getSharedBeamGeometry(): THREE.CylinderGeometry {
  if (!sharedBeamGeo) {
    sharedBeamGeo = new THREE.CylinderGeometry(0.08, 0.45, 6, 8, 1, true);
  }
  return sharedBeamGeo;
}

function getSharedStarGeometry(): THREE.ExtrudeGeometry {
  if (!sharedStarGeo) {
    const starShape = new THREE.Shape();
    const outerRadius = 0.32;
    const innerRadius = 0.16;
    for (let i = 0; i < 10; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = (i * Math.PI) / 5 - Math.PI / 2;
      const sx = Math.cos(angle) * radius;
      const sy = Math.sin(angle) * radius;
      if (i === 0) starShape.moveTo(sx, sy);
      else starShape.lineTo(sx, sy);
    }
    sharedStarGeo = new THREE.ExtrudeGeometry(starShape, {
      depth: 0.08,
      bevelEnabled: true,
      bevelSegments: 2,
      steps: 1,
      bevelSize: 0.02,
      bevelThickness: 0.02,
    });
  }
  return sharedStarGeo;
}

function getSharedStarMaterial(): THREE.MeshStandardMaterial {
  if (!sharedStarMaterial) {
    sharedStarMaterial = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      roughness: 0.2,
      metalness: 0.95,
      emissive: 0x78350f,
      emissiveIntensity: 0.35,
    });
  }
  return sharedStarMaterial;
}

function getSharedCoinGeometry(): THREE.CylinderGeometry {
  if (!sharedCoinGeo) {
    sharedCoinGeo = new THREE.CylinderGeometry(0.115, 0.115, 0.032, 18);
    // Stand coin upright in local space so Y-axis spin reads like a tumbling gold doubloon
    sharedCoinGeo.rotateZ(Math.PI / 2);
  }
  return sharedCoinGeo;
}

function getSharedGlowTexture(): THREE.CanvasTexture {
  if (!sharedGlowTexture) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255, 248, 214, 1)');
    grad.addColorStop(0.32, 'rgba(255, 212, 90, 0.92)');
    grad.addColorStop(0.7, 'rgba(245, 158, 11, 0.35)');
    grad.addColorStop(1, 'rgba(245, 158, 11, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    sharedGlowTexture = new THREE.CanvasTexture(canvas);
    sharedGlowTexture.colorSpace = THREE.SRGBColorSpace;
  }
  return sharedGlowTexture;
}

function getSharedSparkleTexture(): THREE.CanvasTexture {
  if (!sharedSparkleTexture) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(32, 32, 1, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.35, 'rgba(255, 212, 90, 0.95)');
    grad.addColorStop(1, 'rgba(255, 212, 90, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);

    // Subtle 4-point star glint
    ctx.fillStyle = 'rgba(255, 252, 230, 0.9)';
    ctx.beginPath();
    ctx.ellipse(32, 32, 2.2, 20, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(32, 32, 20, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();

    sharedSparkleTexture = new THREE.CanvasTexture(canvas);
    sharedSparkleTexture.colorSpace = THREE.SRGBColorSpace;
  }
  return sharedSparkleTexture;
}

function getZoneHexColor(zoneType: ChestZoneType): number {
  switch (zoneType) {
    case 'main_path':
      return 0xf59e0b; // Amber
    case 'roadside':
      return 0x06b6d4; // Cyan
    case 'forest_edge':
      return 0x10b981; // Emerald
    case 'exploration_area':
      return 0xa855f7; // Violet
  }
}

function normalizeAndMergeMaterialBucket(
  geos: THREE.BufferGeometry[],
  material: THREE.Material
): THREE.Mesh | null {
  if (geos.length === 0) return null;

  const commonAttrs = new Set<string>(Object.keys(geos[0].attributes));
  for (let i = 1; i < geos.length; i++) {
    const keys = new Set(Object.keys(geos[i].attributes));
    commonAttrs.forEach((attr) => {
      if (!keys.has(attr)) commonAttrs.delete(attr);
    });
  }

  for (const g of geos) {
    for (const attr of Object.keys(g.attributes)) {
      if (!commonAttrs.has(attr)) {
        g.deleteAttribute(attr);
      }
    }
    if (!g.getAttribute('normal')) {
      g.computeVertexNormals();
    }
  }

  const merged = geos.length === 1 ? geos[0].clone() : mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  if (!merged) return null;

  material.depthWrite = true;
  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildOptimizedBoxTemplate(scene: THREE.Object3D): THREE.Object3D {
  scene.updateMatrixWorld(true);
  const rawBox = new THREE.Box3().setFromObject(scene);
  const scale = 0.3;

  try {
    const sceneInv = new THREE.Matrix4().copy(scene.matrixWorld).invert();
    const lidSource = scene.getObjectByName('Empty_82') || null;
    const lidNodes = new Set<THREE.Object3D>();
    if (lidSource) {
      lidSource.traverse((node) => lidNodes.add(node));
    }

    const baseBuckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const lidBuckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const lidInv = lidSource ? new THREE.Matrix4().copy(lidSource.matrixWorld).invert() : null;
    const relMatrix = new THREE.Matrix4();

    scene.traverse((node) => {
      if (!(node as THREE.Mesh).isMesh) return;
      const mesh = node as THREE.Mesh;
      if (!mesh.geometry || !mesh.material) return;

      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (!mat) return;

      const isLidMesh = lidNodes.has(mesh) && Boolean(lidInv);
      if (isLidMesh && lidInv) {
        relMatrix.multiplyMatrices(lidInv, mesh.matrixWorld);
      } else {
        relMatrix.multiplyMatrices(sceneInv, mesh.matrixWorld);
      }

      const bakedGeo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      bakedGeo.applyMatrix4(relMatrix);

      const targetMap = isLidMesh ? lidBuckets : baseBuckets;
      let bucket = targetMap.get(mat);
      if (!bucket) {
        bucket = [];
        targetMap.set(mat, bucket);
      }
      bucket.push(bakedGeo);
    });

    if (baseBuckets.size === 0 && lidBuckets.size === 0) {
      throw new Error('No mergeable meshes found in box.glb');
    }

    const optimized = new THREE.Group();
    optimized.name = 'OptimizedChestTemplate';

    baseBuckets.forEach((geos, mat) => {
      const mergedMesh = normalizeAndMergeMaterialBucket(geos, mat);
      if (mergedMesh) {
        optimized.add(mergedMesh);
      }
    });

    if (lidSource && lidBuckets.size > 0) {
      const lidGroup = new THREE.Group();
      lidGroup.name = 'Empty_82';
      const lidRelMat = new THREE.Matrix4().multiplyMatrices(sceneInv, lidSource.matrixWorld);
      lidRelMat.decompose(lidGroup.position, lidGroup.quaternion, lidGroup.scale);

      lidBuckets.forEach((geos, mat) => {
        const mergedMesh = normalizeAndMergeMaterialBucket(geos, mat);
        if (mergedMesh) {
          lidGroup.add(mergedMesh);
        }
      });
      optimized.add(lidGroup);
    }

    // Dispose original unmerged geometries so only the compact merged buffers stay in memory
    scene.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        (node as THREE.Mesh).geometry?.dispose();
      }
    });

    optimized.scale.set(scale, scale, scale);
    optimized.position.y = -rawBox.min.y * scale;
    return optimized;
  } catch (mergeErr) {
    console.warn('[TreasureChest] Fallback to unmerged box.glb template:', mergeErr);
    scene.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        const mesh = node as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => {
              m.depthWrite = true;
            });
          } else {
            mesh.material.depthWrite = true;
          }
        }
      }
    });
    scene.scale.set(scale, scale, scale);
    scene.position.y = -rawBox.min.y * scale;
    return scene;
  }
}

function loadBoxModelTemplate(): Promise<THREE.Object3D> {
  if (cachedBoxTemplate) {
    return Promise.resolve(cachedBoxTemplate);
  }
  if (boxLoadingPromise) {
    return boxLoadingPromise;
  }

  boxLoadingPromise = new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(
      '/assets/models/box.glb',
      (gltf) => {
        const optimizedScene = buildOptimizedBoxTemplate(gltf.scene);
        cachedBoxTemplate = optimizedScene;
        resolve(optimizedScene);
      },
      undefined,
      (err) => {
        console.error('Failed to load box.glb:', err);
        boxLoadingPromise = null;
        reject(err);
      }
    );
  });

  return boxLoadingPromise;
}

interface SparkleParticleSlot {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  active: boolean;
  elapsed: number;
  duration: number;
  vx: number;
  vy: number;
  vz: number;
  baseScale: number;
}

interface CoinSlot {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  active: boolean;
  elapsed: number;
  duration: number;
  vx: number;
  vy: number;
  vz: number;
  spinY: number;
  spinX: number;
}

export interface TreasureChestOptions {
  chestId?: string;
  zoneType?: ChestZoneType;
  interactionRadius?: number;
  active?: boolean;
}

export class TreasureChest {
  public group: THREE.Group;
  public question: Question;
  public chestId: string;
  public questionId: string;
  public zoneType: ChestZoneType;
  public interactionRadius: number;
  public active: boolean;
  public position: THREE.Vector3;
  public status: 'locked' | 'available' | 'completed' = 'available';
  public validationResult: ChestPlacementMeta | null = null;

  private boxModelInstance: THREE.Object3D | null = null;
  private boxMeshes: THREE.Mesh[] = [];
  private isShadowCasting = true;
  private lidNode: THREE.Object3D | null = null;
  private fallbackMesh: THREE.Mesh | null = null;
  private beaconBeam: THREE.Mesh;
  private numberSprite: THREE.Sprite;
  private starMesh: THREE.Mesh;

  // VFX Containers & Pooled Objects
  private vfxGroup: THREE.Group;
  private glowSprite: THREE.Sprite;
  private glowMaterial: THREE.SpriteMaterial;
  private glowActive = false;
  private glowElapsed = 0;
  private readonly glowDuration = 1.05;

  private sparklePool: SparkleParticleSlot[] = [];
  private coinPool: CoinSlot[] = [];
  private coinBurstCooldownUntil = 0;

  // Lid Hinge Animation State
  private lidCurrentAngle = LID_CLOSED_ANGLE;
  private lidStartAngle = LID_CLOSED_ANGLE;
  private lidTargetAngle = LID_CLOSED_ANGLE;
  private lidAnimElapsed = 0;
  private lidAnimDuration = 0;
  private lidAnimMode: 'none' | 'open' | 'close' = 'none';
  private fallbackBounceElapsed = -1;

  // Developer-only debug visualizers (hidden during normal gameplay)
  private debugGroup: THREE.Group;
  private debugRing: THREE.Mesh;
  private debugStatusDot: THREE.Mesh;
  private debugLabelSprite: THREE.Sprite | null = null;

  public openProgress: number = 0;
  public targetOpenProgress: number = 0;

  constructor(
    question: Question,
    position: [number, number, number],
    options: TreasureChestOptions = {}
  ) {
    this.question = question;
    this.questionId = question.id;
    this.chestId = options.chestId || question.id;
    this.zoneType = options.zoneType || question.zoneType || 'main_path';
    this.interactionRadius = options.interactionRadius || 3.4;
    this.active = options.active !== undefined ? options.active : true;
    this.position = new THREE.Vector3(position[0], position[1], position[2]);

    this.group = new THREE.Group();
    this.group.position.copy(this.position);
    this.orientTowardAdventureTrail();

    // 1. Attach cloned merged box.glb model & bind real lid hinge node 'Empty_82'
    loadBoxModelTemplate()
      .then((template) => {
        const instance = template.clone(true);
        this.boxModelInstance = instance;
        this.boxMeshes = [];
        instance.traverse((node) => {
          if ((node as THREE.Mesh).isMesh) {
            const mesh = node as THREE.Mesh;
            mesh.castShadow = this.isShadowCasting;
            this.boxMeshes.push(mesh);
          }
        });
        this.lidNode = instance.getObjectByName('Empty_82') || null;
        if (this.lidNode) {
          this.lidNode.rotation.x = this.lidCurrentAngle;
        }
        this.group.add(instance);
      })
      .catch(() => {
        const fallbackGeo = new THREE.BoxGeometry(1.4, 0.9, 1.0);
        const fallbackMat = new THREE.MeshStandardMaterial({
          color: 0xb45309,
          roughness: 0.4,
          metalness: 0.8,
        });
        const fallbackMesh = new THREE.Mesh(fallbackGeo, fallbackMat);
        fallbackMesh.position.y = 0.45;
        this.fallbackMesh = fallbackMesh;
        this.group.add(fallbackMesh);
      });

    // 2. Floating Question Number Badge (Canvas Texture Sprite)
    this.numberSprite = this.createNumberSprite(question.number);
    this.numberSprite.position.set(0, 1.85, 0);
    this.group.add(this.numberSprite);

    // 3. Completed Star Trophy Mesh (shared geometry & material)
    this.starMesh = new THREE.Mesh(getSharedStarGeometry(), getSharedStarMaterial());
    this.starMesh.position.set(0, 2.05, 0);
    this.starMesh.visible = false;
    this.group.add(this.starMesh);

    // 4. Vertical Magical Beacon Light Column
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.beaconBeam = new THREE.Mesh(getSharedBeamGeometry(), beamMat);
    this.beaconBeam.position.set(0, 3.6, 0);
    this.group.add(this.beaconBeam);

    // 5. Juicy Chest VFX Pool Group (culled when idle to skip matrix/frustum cost)
    this.vfxGroup = new THREE.Group();
    this.vfxGroup.visible = false;
    this.group.add(this.vfxGroup);

    this.glowMaterial = new THREE.SpriteMaterial({
      map: getSharedGlowTexture(),
      color: 0xffd45a,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.glowSprite = new THREE.Sprite(this.glowMaterial);
    this.glowSprite.position.set(0, 0.48, 0.06);
    this.glowSprite.scale.set(0.8, 0.8, 1);
    this.glowSprite.visible = false;
    this.vfxGroup.add(this.glowSprite);

    const sparkleTex = getSharedSparkleTexture();
    for (let i = 0; i < SPARKLE_POOL_SIZE; i++) {
      const mat = new THREE.SpriteMaterial({
        map: sparkleTex,
        color: 0xffd45a,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      this.vfxGroup.add(sprite);
      this.sparklePool.push({
        sprite,
        material: mat,
        active: false,
        elapsed: 0,
        duration: 1.0,
        vx: 0,
        vy: 1,
        vz: 0,
        baseScale: 0.16,
      });
    }

    const coinGeo = getSharedCoinGeometry();
    for (let i = 0; i < COIN_POOL_SIZE; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffd45a,
        emissive: 0xca8a04,
        emissiveIntensity: 0.55,
        metalness: 0.88,
        roughness: 0.16,
        transparent: true,
        opacity: 1,
      });
      const mesh = new THREE.Mesh(coinGeo, mat);
      mesh.visible = false;
      this.vfxGroup.add(mesh);
      this.coinPool.push({
        mesh,
        material: mat,
        active: false,
        elapsed: 0,
        duration: 1.15,
        vx: 0,
        vy: 3.8,
        vz: 0,
        spinY: 9,
        spinX: 3,
      });
    }

    // 6. Developer Debug Gizmos (Strictly hidden unless debugMode === true)
    this.debugGroup = new THREE.Group();
    this.debugGroup.visible = false;
    this.group.add(this.debugGroup);

    const ringGeo = new THREE.RingGeometry(
      Math.max(0.5, this.interactionRadius - 0.1),
      this.interactionRadius,
      36
    );
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: getZoneHexColor(this.zoneType),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });
    this.debugRing = new THREE.Mesh(ringGeo, ringMat);
    this.debugRing.position.y = 0.08;
    this.debugGroup.add(this.debugRing);

    const dotGeo = new THREE.SphereGeometry(0.22, 12, 12);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });
    this.debugStatusDot = new THREE.Mesh(dotGeo, dotMat);
    this.debugStatusDot.position.set(0, 2.75, 0);
    this.debugGroup.add(this.debugStatusDot);
  }

  private orientTowardAdventureTrail() {
    const roadRefX = this.position.z >= 705 ? -44 : 0;
    const dx = roadRefX - this.position.x;
    const dz = this.position.z >= 705 ? -4 : -2.5;
    this.group.rotation.y = Math.atan2(dx, dz);
  }

  /**
   * Triggers smooth chest lid opening (~540ms), warm #FFD45A interior glow,
   * and 12 rising golden sparkle particles. Safe against duplicate rapid calls.
   */
  public triggerOpenEffect() {
    if (this.lidAnimMode === 'open' && this.lidAnimElapsed < 0.25) {
      return;
    }

    this.lidStartAngle = this.lidCurrentAngle;
    this.lidTargetAngle = LID_OPEN_ANGLE;
    this.lidAnimElapsed = 0;
    this.lidAnimDuration = 0.54;
    this.lidAnimMode = 'open';
    this.targetOpenProgress = 1;
    this.fallbackBounceElapsed = 0;

    // Activate interior warm golden glow (#FFD45A)
    this.vfxGroup.visible = true;
    this.glowActive = true;
    this.glowElapsed = 0;
    this.glowSprite.visible = true;
    this.glowSprite.scale.set(0.65, 0.65, 1);
    this.glowMaterial.opacity = 0;

    // Activate pooled golden sparkle particles (8-16 -> 12 particles, 850-1250ms)
    for (let i = 0; i < this.sparklePool.length; i++) {
      const slot = this.sparklePool[i];
      const angle = (i / this.sparklePool.length) * Math.PI * 2 + (Math.random() - 0.5) * 0.45;
      const spreadSpeed = 0.18 + Math.random() * 0.34;
      slot.active = true;
      slot.elapsed = 0;
      slot.duration = 0.85 + Math.random() * 0.4;
      slot.vx = Math.cos(angle) * spreadSpeed;
      slot.vz = Math.sin(angle) * spreadSpeed;
      slot.vy = 0.95 + Math.random() * 0.8;
      slot.baseScale = 0.12 + Math.random() * 0.14;
      slot.sprite.position.set(
        (Math.random() - 0.5) * 0.52,
        0.4 + Math.random() * 0.12,
        (Math.random() - 0.5) * 0.36
      );
      slot.sprite.scale.set(slot.baseScale, slot.baseScale, 1);
      slot.material.opacity = 0;
      slot.sprite.visible = true;
    }
  }

  /**
   * Smoothly closes chest lid if the student backed out without submitting an answer,
   * or settles gently when marked completed.
   */
  public triggerCloseEffect(targetAngle: number = LID_CLOSED_ANGLE) {
    this.lidStartAngle = this.lidCurrentAngle;
    this.lidTargetAngle = targetAngle;
    this.lidAnimElapsed = 0;
    this.lidAnimDuration = 0.38;
    this.lidAnimMode = 'close';
    this.targetOpenProgress = targetAngle === LID_CLOSED_ANGLE ? 0 : 0.72;
  }

  /**
   * Launches 7 spinning parabolic gold coins from inside the chest.
   * Strictly called ONLY after authoritative server confirmation that answer.isCorrect === true!
   */
  public triggerCoinRewardEffect() {
    const now = performance.now();
    if (now < this.coinBurstCooldownUntil) return;
    this.coinBurstCooldownUntil = now + 350;

    // Keep lid open smoothly during coin reward burst
    if (this.lidCurrentAngle > LID_COMPLETED_ANGLE) {
      this.lidStartAngle = this.lidCurrentAngle;
      this.lidTargetAngle = LID_OPEN_ANGLE;
      this.lidAnimElapsed = 0;
      this.lidAnimDuration = 0.35;
      this.lidAnimMode = 'open';
    }

    // Re-pulse warm glow subtly with coin burst
    this.vfxGroup.visible = true;
    this.glowActive = true;
    this.glowElapsed = 0;
    this.glowSprite.visible = true;

    for (let i = 0; i < this.coinPool.length; i++) {
      const slot = this.coinPool[i];
      const angle = (i / this.coinPool.length) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
      const horizSpeed = 0.72 + Math.random() * 0.78;
      slot.active = true;
      slot.elapsed = -i * 0.035; // Slight stagger (~35ms) for lush fountain arc
      slot.duration = 0.98 + Math.random() * 0.28; // 980-1260ms
      slot.vx = Math.cos(angle) * horizSpeed;
      slot.vz = Math.sin(angle) * horizSpeed;
      slot.vy = 3.35 + Math.random() * 1.15;
      slot.spinY = (Math.random() > 0.5 ? 1 : -1) * (7.5 + Math.random() * 4.5);
      slot.spinX = 2.0 + Math.random() * 3.0;
      slot.mesh.position.set(
        (Math.random() - 0.5) * 0.26,
        0.46,
        (Math.random() - 0.5) * 0.2
      );
      slot.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      slot.mesh.scale.setScalar(1);
      slot.material.opacity = 1;
      slot.mesh.visible = true;
    }
  }

  public setValidatedPlacement(meta: ChestPlacementMeta) {
    this.validationResult = meta;
    this.position.set(meta.position.x, meta.position.y, meta.position.z);
    this.group.position.copy(this.position);
    this.orientTowardAdventureTrail();

    const dotMat = this.debugStatusDot.material as THREE.MeshBasicMaterial;
    if (!meta.valid) {
      dotMat.color.setHex(0xef4444);
    } else if (meta.adjusted) {
      dotMat.color.setHex(0xf59e0b);
    } else {
      dotMat.color.setHex(0x10b981);
    }

    if (this.debugLabelSprite) {
      this.debugGroup.remove(this.debugLabelSprite);
      this.debugLabelSprite.material.map?.dispose();
      this.debugLabelSprite.material.dispose();
    }
    this.debugLabelSprite = this.createDebugLabelSprite(
      `#${this.question.number} ${this.zoneType.toUpperCase()}`,
      meta.valid ? (meta.adjusted ? 'ADJ' : 'OK') : 'ERR'
    );
    this.debugLabelSprite.position.set(0, 3.35, 0);
    this.debugGroup.add(this.debugLabelSprite);
  }

  public setDebugMode(enabled: boolean) {
    this.debugGroup.visible = enabled;
  }

  public setCastShadow(enabled: boolean) {
    if (this.isShadowCasting === enabled) return;
    this.isShadowCasting = enabled;
    for (let i = 0; i < this.boxMeshes.length; i++) {
      this.boxMeshes[i].castShadow = enabled;
    }
  }

  private createDebugLabelSprite(title: string, statusTag: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.fillRect(8, 12, 496, 104);
    ctx.strokeStyle = statusTag === 'OK' ? '#10b981' : statusTag === 'ADJ' ? '#f59e0b' : '#ef4444';
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 12, 496, 104);

    ctx.font = 'bold 34px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(`${title} [${statusTag}]`, 256, 64);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(3.4, 0.85, 1);
    return sprite;
  }

  private createNumberSprite(num: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    ctx.beginPath();
    ctx.arc(128, 128, 100, 0, Math.PI * 2);
    ctx.fillStyle = '#b45309';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(128, 128, 88, 0, Math.PI * 2);
    ctx.fillStyle = '#f59e0b';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(128, 128, 76, 0, Math.PI * 2);
    ctx.fillStyle = '#78350f';
    ctx.fill();

    ctx.font = 'bold 84px Cinzel, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${num}`, 128, 128);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.15, 1.15, 1.15);
    return sprite;
  }

  public setStatus(status: 'locked' | 'available' | 'completed') {
    const prevStatus = this.status;
    this.status = status;

    if (status === 'completed') {
      this.starMesh.visible = true;
      this.numberSprite.visible = false;
      (this.beaconBeam.material as THREE.MeshBasicMaterial).color.setHex(0x10b981);

      if (prevStatus !== 'completed' && this.lidAnimMode === 'none') {
        if (Math.abs(this.lidCurrentAngle - LID_COMPLETED_ANGLE) > 0.05) {
          this.lidCurrentAngle = LID_COMPLETED_ANGLE;
          if (this.lidNode) {
            this.lidNode.rotation.x = LID_COMPLETED_ANGLE;
          }
        }
      }
    } else if (status === 'locked') {
      this.starMesh.visible = false;
      this.numberSprite.visible = true;
      (this.beaconBeam.material as THREE.MeshBasicMaterial).color.setHex(0x64748b);
    } else {
      this.starMesh.visible = false;
      this.numberSprite.visible = true;
      (this.beaconBeam.material as THREE.MeshBasicMaterial).color.setHex(0xf59e0b);
    }
  }

  public update(delta: number, sharedTimeSec?: number, distSqToPlayer?: number) {
    const hasActiveAnimation =
      this.lidAnimMode !== 'none' || this.vfxGroup.visible || this.fallbackBounceElapsed >= 0;

    // Skip idle chest bob/pulse CPU work when far beyond camera visibility (~150m+)
    if (distSqToPlayer !== undefined && distSqToPlayer > 150 * 150 && !hasActiveAnimation) {
      return;
    }

    const clampedDelta = Math.min(delta, 0.08);
    const time = sharedTimeSec !== undefined ? sharedTimeSec : performance.now() * 0.003;
    const floatY = Math.sin(time + this.question.number) * 0.12;
    this.numberSprite.position.y = 1.85 + floatY;
    if (this.starMesh.visible) {
      this.starMesh.position.y = 2.05 + floatY;
      this.starMesh.rotation.y += clampedDelta * 1.5;
    }

    // Beacon beam gentle pulsing
    const pulse = 0.25 + Math.sin(time * 2) * 0.1;
    (this.beaconBeam.material as THREE.MeshBasicMaterial).opacity = pulse;

    // 1. Hinged Lid Rotation Animation ('Empty_82') or Safe Fallback
    if (this.lidAnimMode !== 'none' && this.lidAnimDuration > 0) {
      this.lidAnimElapsed += clampedDelta;
      const t = Math.min(1, this.lidAnimElapsed / this.lidAnimDuration);
      const eased = this.lidAnimMode === 'open' ? easeOutBack(t) : easeInOutCubic(t);
      this.lidCurrentAngle =
        this.lidStartAngle + (this.lidTargetAngle - this.lidStartAngle) * eased;

      if (this.lidNode) {
        this.lidNode.rotation.x = this.lidCurrentAngle;
      }

      if (t >= 1) {
        this.lidCurrentAngle = this.lidTargetAngle;
        if (this.lidNode) {
          this.lidNode.rotation.x = this.lidTargetAngle;
        }
        this.lidAnimMode = 'none';
        this.openProgress = this.targetOpenProgress;
      }
    }

    if (this.fallbackMesh && this.fallbackBounceElapsed >= 0) {
      this.fallbackBounceElapsed += clampedDelta;
      const bt = Math.min(1, this.fallbackBounceElapsed / 0.45);
      const s = 1 + Math.sin(bt * Math.PI) * 0.12;
      this.fallbackMesh.scale.set(s, 1 + Math.sin(bt * Math.PI) * 0.16, s);
      if (bt >= 1) {
        this.fallbackMesh.scale.set(1, 1, 1);
        this.fallbackBounceElapsed = -1;
      }
    }

    // 2. Warm Golden Interior Glow Sprite (#FFD45A)
    if (this.glowActive) {
      this.glowElapsed += clampedDelta;
      const gt = Math.min(1, this.glowElapsed / this.glowDuration);
      let opacity = 0;
      if (gt < 0.22) {
        opacity = (gt / 0.22) * 0.88;
      } else {
        opacity = (1 - (gt - 0.22) / 0.78) * 0.88;
      }
      const glowScale = 0.75 + Math.sin(Math.min(1, gt) * Math.PI) * 0.95;
      this.glowSprite.scale.set(glowScale, glowScale * 0.9, 1);
      this.glowMaterial.opacity = Math.max(0, opacity);

      if (gt >= 1) {
        this.glowActive = false;
        this.glowMaterial.opacity = 0;
        this.glowSprite.visible = false;
      }
    }

    // 3. Pooled Golden Sparkle Particles (rise + soft spread + fade)
    let anyVfxActive = this.glowActive;
    for (let i = 0; i < this.sparklePool.length; i++) {
      const slot = this.sparklePool[i];
      if (!slot.active) continue;

      slot.elapsed += clampedDelta;
      const st = Math.min(1, slot.elapsed / slot.duration);
      slot.sprite.position.x += slot.vx * clampedDelta;
      slot.sprite.position.y += slot.vy * clampedDelta;
      slot.sprite.position.z += slot.vz * clampedDelta;
      slot.vy *= 1 - 0.65 * clampedDelta;

      const fade = st < 0.2 ? st / 0.2 : Math.max(0, 1 - (st - 0.2) / 0.8);
      slot.material.opacity = fade * 0.95;
      const s = slot.baseScale * (0.75 + Math.sin(st * Math.PI) * 0.55);
      slot.sprite.scale.set(s, s, 1);

      if (st >= 1) {
        slot.active = false;
        slot.material.opacity = 0;
        slot.sprite.visible = false;
      } else {
        anyVfxActive = true;
      }
    }

    // 4. Pooled Parabolic Gold Coins (active ONLY after confirmed correct answer)
    const gravity = -9.2;
    for (let i = 0; i < this.coinPool.length; i++) {
      const slot = this.coinPool[i];
      if (!slot.active) continue;

      slot.elapsed += clampedDelta;
      if (slot.elapsed < 0) {
        slot.mesh.visible = false;
        anyVfxActive = true;
        continue;
      }
      slot.mesh.visible = true;

      const ct = Math.min(1, slot.elapsed / slot.duration);
      slot.mesh.position.x += slot.vx * clampedDelta;
      slot.mesh.position.y += slot.vy * clampedDelta;
      slot.mesh.position.z += slot.vz * clampedDelta;
      slot.vy += gravity * clampedDelta;

      // Prevent coins sinking beneath ground/chest rim
      if (slot.mesh.position.y < 0.18) {
        slot.mesh.position.y = 0.18;
        slot.vy = Math.abs(slot.vy) * 0.25;
      }

      slot.mesh.rotation.y += slot.spinY * clampedDelta;
      slot.mesh.rotation.x += slot.spinX * clampedDelta;

      const fade = ct < 0.7 ? 1 : Math.max(0, 1 - (ct - 0.7) / 0.3);
      slot.material.opacity = fade;
      const sc = ct < 0.15 ? 0.65 + (ct / 0.15) * 0.35 : ct > 0.75 ? Math.max(0.2, fade) : 1;
      slot.mesh.scale.setScalar(sc);

      if (ct >= 1) {
        slot.active = false;
        slot.material.opacity = 0;
        slot.mesh.visible = false;
      } else {
        anyVfxActive = true;
      }
    }

    if (this.vfxGroup.visible && !anyVfxActive) {
      this.vfxGroup.visible = false;
    }
  }

  /**
   * Cleanly disposes per-chest materials, textures, and child geometries on canvas unmount.
   */
  public dispose() {
    this.glowMaterial.dispose();
    this.sparklePool.forEach((slot) => slot.material.dispose());
    this.coinPool.forEach((slot) => slot.material.dispose());

    (this.beaconBeam.material as THREE.Material).dispose();
    this.numberSprite.material.map?.dispose();
    this.numberSprite.material.dispose();

    (this.debugRing.material as THREE.Material).dispose();
    this.debugRing.geometry.dispose();
    (this.debugStatusDot.material as THREE.Material).dispose();
    this.debugStatusDot.geometry.dispose();

    if (this.debugLabelSprite) {
      this.debugLabelSprite.material.map?.dispose();
      this.debugLabelSprite.material.dispose();
    }

    if (this.fallbackMesh) {
      this.fallbackMesh.geometry.dispose();
      (this.fallbackMesh.material as THREE.Material).dispose();
    }
  }
}
