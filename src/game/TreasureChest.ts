/**
 * 3D Interactive Treasure Chest Model for Pirate Academy
 * Uses public/assets/models/box.glb (ornate treasure chest with gold & crystal trims)
 * Features Question Number Badge, Magical Beacon Light, Completion Star,
 * Spatial Zone Metadata, and Developer-Only Placement Debug Gizmos.
 * Created by Deni Raja99
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ChestPlacementMeta, ChestZoneType, Question } from '../types/game';

// Shared GLTF model template cache to avoid multiple 3.4MB downloads
let cachedBoxTemplate: THREE.Object3D | null = null;
let boxLoadingPromise: Promise<THREE.Object3D> | null = null;
let sharedBeamGeo: THREE.CylinderGeometry | null = null;
let sharedStarGeo: THREE.ExtrudeGeometry | null = null;

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
        const scene = gltf.scene;

        // Configure shadows & depth on all mesh children
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

        // Compute raw bounding box
        const rawBox = new THREE.Box3().setFromObject(scene);

        // Optimal scale ~0.30 makes width ~1.53m, height ~1.07m
        const scale = 0.30;
        scene.scale.set(scale, scale, scale);

        // Ground offset: rawBox.min.y is -0.06m -> lift by +0.018m so bottom sits flush on ground
        scene.position.y = -rawBox.min.y * scale;

        cachedBoxTemplate = scene;
        resolve(scene);
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
  private beaconBeam: THREE.Mesh;
  private numberSprite: THREE.Sprite;
  private starMesh: THREE.Mesh;

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

    // 1. Attach cloned box.glb model
    loadBoxModelTemplate()
      .then((template) => {
        const instance = template.clone(true);
        this.boxModelInstance = instance;
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
        this.group.add(fallbackMesh);
      });

    // 2. Floating Question Number Badge (Canvas Texture Sprite)
    this.numberSprite = this.createNumberSprite(question.number);
    this.numberSprite.position.set(0, 1.85, 0);
    this.group.add(this.numberSprite);

    // 3. Completed Star Trophy Mesh (shared geometry)
    const starMat = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      roughness: 0.2,
      metalness: 0.95,
      emissive: 0x78350f,
      emissiveIntensity: 0.35,
    });
    this.starMesh = new THREE.Mesh(getSharedStarGeometry(), starMat);
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

    // 5. Developer Debug Gizmos (Strictly hidden unless debugMode === true)
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
    // Face naturally back toward the trail axis so player sees front clasp cleanly
    const roadRefX = this.position.z >= 705 ? -44 : 0;
    const dx = roadRefX - this.position.x;
    const dz = this.position.z >= 705 ? -4 : -2.5;
    this.group.rotation.y = Math.atan2(dx, dz);
  }

  public setValidatedPlacement(meta: ChestPlacementMeta) {
    this.validationResult = meta;
    this.position.set(meta.position.x, meta.position.y, meta.position.z);
    this.group.position.copy(this.position);
    this.orientTowardAdventureTrail();

    // Update debug status dot & label
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

    // Golden ornate wax seal circle
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

    // Chest number text
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
    this.status = status;
    if (status === 'completed') {
      this.starMesh.visible = true;
      this.numberSprite.visible = false;
      (this.beaconBeam.material as THREE.MeshBasicMaterial).color.setHex(0x10b981);
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

  public update(delta: number) {
    // Floating animation of badge/star
    const time = performance.now() * 0.003;
    const floatY = Math.sin(time + this.question.number) * 0.12;
    this.numberSprite.position.y = 1.85 + floatY;
    if (this.starMesh.visible) {
      this.starMesh.position.y = 2.05 + floatY;
      this.starMesh.rotation.y += delta * 1.5;
    }

    // Beacon beam gentle pulsing
    const pulse = 0.25 + Math.sin(time * 2) * 0.1;
    (this.beaconBeam.material as THREE.MeshBasicMaterial).opacity = pulse;
  }
}
