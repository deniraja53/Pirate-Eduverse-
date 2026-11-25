/**
 * MapEnvironment Manager for Pirate Academy: Treasure Quest
 * Manages game_pirate_adventure_map.glb, Tightened Curved Wooden Bridge Colliders,
 * Spatial-Hashed Solid Obstacle Triangle Colliders (peijing), Water/Shoreline & Chasm Boundary Detection,
 * Capsule-vs-Environment Sliding Resolution, and Developer-Only Debug Wireframes.
 * Created by Deni Raja99
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GameConfig } from './GameConfig';
import type { ChestPlacementMeta, ChestZoneType } from '../types/game';

THREE.Cache.enabled = true;

export type SurfaceCategory =
  | 'road'
  | 'bridge'
  | 'sand_land'
  | 'water_shore'
  | 'chasm_void'
  | 'steep_cliff'
  | 'map_boundary'
  | 'obstacle';

export interface ObstacleCollider {
  id: string;
  shape: 'cylinder' | 'box';
  label: string;
  x: number;
  z: number;
  minY: number;
  maxY: number;
  radius?: number;
  halfX?: number;
  halfZ?: number;
}

export interface ChestCollisionVolume {
  id: string;
  x: number;
  y: number;
  z: number;
  radius: number;
}

export interface MapCollisionStats {
  solidObstacleTriangles: number;
  indexedGridCells: number;
  obstaclePrimitivesCount: number;
  unclassifiedMeshes: string[];
}

export interface MapDiagnostics {
  status: 'loading' | 'loaded' | 'error';
  path: string;
  originalBoxMin?: { x: number; y: number; z: number };
  originalBoxMax?: { x: number; y: number; z: number };
  originalBoxSize?: { x: number; y: number; z: number };
  scaledBoxSize?: { x: number; y: number; z: number };
  meshCount: number;
  walkableMeshCount: number;
  bridgeDetected: boolean;
  message: string;
}

export interface RaycastDebugData {
  footPos: { x: number; y: number; z: number };
  prevPos: { x: number; y: number; z: number };
  desiredPos: { x: number; y: number; z: number };
  rayOrigin: { x: number; y: number; z: number };
  hitPoint: { x: number; y: number; z: number } | null;
  detectedMeshName: string;
  usedSurfaceHeight: number;
  isGrounded: boolean;
  isOnBridge: boolean;
  totalHits: number;
  surfaceCategory: SurfaceCategory;
  isWalkableSurface: boolean;
  isCollidingObstacle: boolean;
  isAtBoundary: boolean;
  collidingObstacleLabel?: string;
  blockingColliderId?: string;
  blockingReason: string;
  playerColliderRadius: number;
  playerColliderHeight: number;
  finishDistance: number;
  isInsideFinishZone: boolean;
  stats: MapCollisionStats;
}

/**
 * Canonical Finish Ship & Embarkation Shore Area derived from game_pirate_adventure_map.glb
 * - Walkable Finish beach spans Z=724..774, X=-88..-71 overlooking the anchored Pirate Ship (X=-75..-28, Z=742..776)
 * - Non-solid Finish Trigger Zone sits on flat dry sand right before the ship bow & Finish Monument
 */
export const FINISH_SHIP_AREA = {
  triggerCenter: { x: -76.5, z: 744.5 },
  triggerRadius: 4.8,
  monumentPos: { x: -76.5, z: 749.5 },
  shipHullBounds: { minX: -76.0, maxX: -28.0, minZ: 740.0, maxZ: 778.0 },
  entryCorridorBounds: { minX: -85.0, maxX: -72.0, minZ: 722.5, maxZ: 752.0 },
} as const;

export interface GroundSurfaceResult {
  y: number;
  hit: boolean;
  walkable: boolean;
  meshName: string;
  isOnBridge: boolean;
  slopeNormalY: number;
  category: SurfaceCategory;
}

export interface CapsuleResolutionResult {
  x: number;
  z: number;
  groundY: number;
  grounded: boolean;
  isOnBridge: boolean;
  surfaceCategory: SurfaceCategory;
  collidedObstacle: boolean;
  hitBoundary: boolean;
  obstacleLabel?: string;
}

interface SolidTriangle {
  id: number;
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  cx: number;
  cy: number;
  cz: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  nx: number;
  ny: number;
  nz: number;
  label: string;
  colliderId: string;
}

// Reusable module-scope math objects (Zero GC inside frame loop)
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vC = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _triNormal = new THREE.Vector3();
const _tri = new THREE.Triangle();
const _sphereCenter = new THREE.Vector3();
const _closestPt = new THREE.Vector3();
const _rayOrigin = new THREE.Vector3();
const _downVec = new THREE.Vector3(0, -1, 0);
const _normalMat = new THREE.Matrix3();
const _worldNorm = new THREE.Vector3();
const _chestRaycaster = new THREE.Raycaster();
const _chestRayOrigin = new THREE.Vector3();
const _dbgHitVec = new THREE.Vector3();

const SPATIAL_CELL_SIZE = 2.0;

interface CachedSpatialIndex {
  solidTriangles: SolidTriangle[];
  spatialGrid: Map<number, SolidTriangle[]>;
  obstacleColliders: ObstacleCollider[];
  unclassifiedMeshes: string[];
}

const cachedMapTemplatePromises = new Map<string, Promise<THREE.Object3D>>();
const cachedSpatialIndexMap = new Map<string, CachedSpatialIndex>();

function loadCachedMapScene(mapGlbPath: string): Promise<THREE.Object3D> {
  const existing = cachedMapTemplatePromises.get(mapGlbPath);
  if (existing) return existing;

  const promise = new Promise<THREE.Object3D>((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(
      mapGlbPath,
      (gltf) => resolve(gltf.scene),
      undefined,
      (err) => {
        cachedMapTemplatePromises.delete(mapGlbPath);
        reject(err);
      }
    );
  });
  cachedMapTemplatePromises.set(mapGlbPath, promise);
  return promise;
}

function cellKey(gx: number, gz: number): number {
  // Deterministic 2D integer pair hash within [-2048..2047]
  return ((gx + 2048) << 12) | ((gz + 2048) & 0xfff);
}

export class MapEnvironment {
  public group: THREE.Group;
  public mapModel: THREE.Object3D | null = null;
  public walkableMeshes: THREE.Mesh[] = [];
  public bridgeMeshes: THREE.Mesh[] = [];
  public westShoreMeshes: THREE.Mesh[] = [];
  public environmentMeshes: THREE.Mesh[] = [];
  public allMeshes: THREE.Mesh[] = [];
  public diagnostics: MapDiagnostics;

  // Dedicated Static Bridge Colliders
  public bridgeColliderGroup: THREE.Group;

  // Spatial-Hashed Solid Obstacle Colliders
  private solidTriangles: SolidTriangle[] = [];
  private spatialGrid: Map<number, SolidTriangle[]> = new Map();
  private triQueryStamp: Int32Array = new Int32Array(0);
  private currentQueryStamp: number = 1;
  public obstacleColliders: ObstacleCollider[] = [];
  public collisionStats: MapCollisionStats = {
    solidObstacleTriangles: 0,
    indexedGridCells: 0,
    obstaclePrimitivesCount: 0,
    unclassifiedMeshes: [],
  };

  // Developer-Only 3D Debug Visualizers (hidden when debugMode === false)
  public debugVisualGroup: THREE.Group;
  private debugFootMarker: THREE.Mesh;
  private debugHitMarker: THREE.Mesh;
  private debugRayLine: THREE.Line;
  private debugObstacleWireframes: THREE.Group;
  public latestDebugData: RaycastDebugData;

  private raycaster: THREE.Raycaster;
  public config: GameConfig;

  constructor(config: GameConfig) {
    this.config = config;
    this.group = new THREE.Group();
    this.bridgeColliderGroup = new THREE.Group();
    this.group.add(this.bridgeColliderGroup);

    this.debugVisualGroup = new THREE.Group();
    this.debugVisualGroup.visible = Boolean(config.debugMode);
    this.group.add(this.debugVisualGroup);

    this.debugObstacleWireframes = new THREE.Group();
    this.debugVisualGroup.add(this.debugObstacleWireframes);

    this.raycaster = new THREE.Raycaster();

    // Initialize 3D debug helpers
    const sphereGeo = new THREE.SphereGeometry(0.16, 12, 12);
    const footMat = new THREE.MeshBasicMaterial({ color: 0x10b981, wireframe: true });
    this.debugFootMarker = new THREE.Mesh(sphereGeo, footMat);
    this.debugVisualGroup.add(this.debugFootMarker);

    const hitMat = new THREE.MeshBasicMaterial({ color: 0x06b6d4 });
    this.debugHitMarker = new THREE.Mesh(sphereGeo, hitMat);
    this.debugVisualGroup.add(this.debugHitMarker);

    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, -2, 0),
    ]);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xfacc15 });
    this.debugRayLine = new THREE.Line(lineGeo, lineMat);
    this.debugVisualGroup.add(this.debugRayLine);

    this.latestDebugData = {
      footPos: { x: 0, y: 0, z: 0 },
      prevPos: { x: 0, y: 0, z: 0 },
      desiredPos: { x: 0, y: 0, z: 0 },
      rayOrigin: { x: 0, y: 0, z: 0 },
      hitPoint: null,
      detectedMeshName: 'Belum terdeteksi',
      usedSurfaceHeight: 0,
      isGrounded: true,
      isOnBridge: false,
      totalHits: 0,
      surfaceCategory: 'road',
      isWalkableSurface: true,
      isCollidingObstacle: false,
      isAtBoundary: false,
      blockingReason: 'OK (Lintasan terbuka)',
      playerColliderRadius: config.playerColliderRadius,
      playerColliderHeight: config.playerColliderHeight,
      finishDistance: 999,
      isInsideFinishZone: false,
      stats: { ...this.collisionStats },
    };

    this.diagnostics = {
      status: 'loading',
      path: config.mapGlbPath,
      meshCount: 0,
      walkableMeshCount: 0,
      bridgeDetected: false,
      message: 'Memuat peta petualangan 3D...',
    };
  }

  /**
   * Load map GLB asynchronously via URL (browser runtime) with shared template & spatial cache
   */
  public loadMap(onSuccess?: () => void, onError?: (err: Error) => void): Promise<void> {
    const mapPath = this.config.mapGlbPath;
    return loadCachedMapScene(mapPath)
      .then((templateScene) => {
        const clonedScene = templateScene.clone(true);
        const spatialKey = `${mapPath}::${this.config.mapScale}`;
        this.initFromScene(clonedScene, spatialKey);
        if (onSuccess) onSuccess();
      })
      .catch((err) => {
        console.error('Error loading map GLB:', err);
        this.diagnostics.status = 'error';
        this.diagnostics.message = `Gagal memuat peta (${this.config.mapGlbPath}): ${(err as Error).message}`;
        if (onError) onError(err as Error);
        throw err;
      });
  }

  /**
   * Initialize meshes, bridge colliders, spatial-hashed obstacle geometry, and debug wireframes
   * from an already-loaded THREE.Object3D map root (usable in both browser & headless tests).
   */
  public initFromScene(mapSceneRoot: THREE.Object3D, spatialCacheKey?: string): void {
    if (this.mapModel && this.mapModel.parent === this.group) {
      this.group.remove(this.mapModel);
    }

    this.mapModel = mapSceneRoot;

    // 1. Raw bounding box before scaling
    const rawBox = new THREE.Box3().setFromObject(this.mapModel);
    const rawSize = new THREE.Vector3();
    rawBox.getSize(rawSize);

    this.diagnostics.originalBoxMin = {
      x: Math.round(rawBox.min.x),
      y: Math.round(rawBox.min.y),
      z: Math.round(rawBox.min.z),
    };
    this.diagnostics.originalBoxMax = {
      x: Math.round(rawBox.max.x),
      y: Math.round(rawBox.max.y),
      z: Math.round(rawBox.max.z),
    };
    this.diagnostics.originalBoxSize = {
      x: Math.round(rawSize.x),
      y: Math.round(rawSize.y),
      z: Math.round(rawSize.z),
    };

    // 2. Apply scale (0.01: cm to meters)
    const scale = this.config.mapScale;
    this.mapModel.scale.set(scale, scale, scale);
    this.mapModel.position.set(0, 0, 0);
    this.mapModel.updateMatrixWorld(true);

    // 3. Strictly classify all meshes
    this.walkableMeshes = [];
    this.bridgeMeshes = [];
    this.westShoreMeshes = [];
    this.environmentMeshes = [];
    this.allMeshes = [];
    const unclassified: string[] = [];

    this.mapModel.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        const mesh = node as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((mat) => {
              mat.depthWrite = true;
            });
          } else {
            mesh.material.depthWrite = true;
          }
        }

        this.allMeshes.push(mesh);
        const name = mesh.name || 'unnamed_mesh';

        if (name.includes('wandaoyou_daolu')) {
          this.bridgeMeshes.push(mesh);
          this.walkableMeshes.push(mesh);
          this.diagnostics.bridgeDetected = true;
        } else if (name.includes('daolu')) {
          this.walkableMeshes.push(mesh);
        } else if (name.includes('wandaoyou_dimian')) {
          // Chasm/ravine mesh — ONLY valid on the far west finish shoreline (X <= -68, Z >= 706, Y >= -0.45)
          this.westShoreMeshes.push(mesh);
        } else if (name.includes('dimian')) {
          this.walkableMeshes.push(mesh);
        } else if (name.includes('peijing')) {
          this.environmentMeshes.push(mesh);
        } else {
          unclassified.push(name);
        }
      }
    });

    if (unclassified.length > 0 && this.config.debugMode) {
      console.warn('[MapEnvironment] Unclassified meshes detected:', unclassified);
    }

    // 4. Construct tightened bridge static colliders
    this.buildBridgeColliders();

    // 5. Build or reuse Spatial Hash Grid & Primitive Obstacle Colliders from peijing environment meshes
    const cachedSpatial = spatialCacheKey ? cachedSpatialIndexMap.get(spatialCacheKey) : undefined;
    if (cachedSpatial) {
      this.solidTriangles = cachedSpatial.solidTriangles;
      this.spatialGrid = cachedSpatial.spatialGrid;
      this.obstacleColliders = cachedSpatial.obstacleColliders;
      this.triQueryStamp = new Int32Array(this.solidTriangles.length);
      this.currentQueryStamp = 1;
      this.collisionStats = {
        solidObstacleTriangles: this.solidTriangles.length,
        indexedGridCells: this.spatialGrid.size,
        obstaclePrimitivesCount: this.obstacleColliders.length,
        unclassifiedMeshes: cachedSpatial.unclassifiedMeshes,
      };
    } else {
      this.buildObstacleSpatialIndex(unclassified);
      if (spatialCacheKey && this.solidTriangles.length > 0) {
        cachedSpatialIndexMap.set(spatialCacheKey, {
          solidTriangles: this.solidTriangles,
          spatialGrid: this.spatialGrid,
          obstacleColliders: this.obstacleColliders,
          unclassifiedMeshes: unclassified,
        });
      }
    }

    // 6. Build Developer Debug Wireframe Geometry
    this.buildDebugWireframes();

    // Update diagnostics
    const scaledSize = rawSize.clone().multiplyScalar(scale);
    this.diagnostics.scaledBoxSize = {
      x: Math.round(scaledSize.x),
      y: Math.round(scaledSize.y),
      z: Math.round(scaledSize.z),
    };
    this.diagnostics.meshCount = this.allMeshes.length;
    this.diagnostics.walkableMeshCount =
      this.walkableMeshes.length + this.bridgeColliderGroup.children.length;
    this.diagnostics.status = 'loaded';
    this.diagnostics.message = `Peta GLB siap! Lintasan: ${scaledSize.z.toFixed(0)}m • ${this.collisionStats.solidObstacleTriangles} tri obstacle terindeks`;

    this.group.add(this.mapModel);
  }

  /**
   * Builds tightened static bridge colliders matching actual hw_wandaoyou_daolu_01 planks
   * from Z=630 across the curve (Z=704..714) to the west horizontal bridge deck (X=-88..-1, Z=714.5..723.2).
   * Prevents floating invisible bridge platforms over open ocean/chasm!
   */
  private buildBridgeColliders() {
    this.bridgeColliderGroup.clear();

    const colliderMat = new THREE.MeshBasicMaterial({
      visible: false,
      side: THREE.DoubleSide,
    });

    const straightWaypoints = [
      { z: 629.6, x: 0, width: 9.2, y: 0.00 },
      { z: 660, x: 0, width: 9.2, y: 0.00 },
      { z: 690, x: 0, width: 9.2, y: 0.00 },
      { z: 702, x: 0, width: 9.2, y: 0.00 },
      { z: 706, x: -0.6, width: 9.6, y: 0.08 },
      { z: 710, x: -1.6, width: 10.2, y: 0.20 },
      { z: 715, x: -2.2, width: 10.8, y: 0.32 },
      { z: 720, x: -3.2, width: 11.0, y: 0.34 },
    ];

    for (let i = 0; i < straightWaypoints.length - 1; i++) {
      const p0 = straightWaypoints[i];
      const p1 = straightWaypoints[i + 1];

      const geo = new THREE.BufferGeometry();
      const halfW0 = p0.width / 2;
      const halfW1 = p1.width / 2;

      // Counter-clockwise when viewed from +Y so vertex normals point UP (ny = +1.0)
      const positions = new Float32Array([
        p0.x - halfW0, p0.y + 0.015, p0.z,
        p1.x - halfW1, p1.y + 0.015, p1.z,
        p0.x + halfW0, p0.y + 0.015, p0.z,

        p0.x + halfW0, p0.y + 0.015, p0.z,
        p1.x - halfW1, p1.y + 0.015, p1.z,
        p1.x + halfW1, p1.y + 0.015, p1.z,
      ]);
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.computeVertexNormals();

      const mesh = new THREE.Mesh(geo, colliderMat);
      mesh.name = `BridgeStaticCollider_Approach_${i + 1}`;
      this.bridgeColliderGroup.add(mesh);
    }

    // Westbound wooden bridge deck span matching hw_wandaoyou_daolu_01: X in [-88..+2.8], Z in [714.5..723.0]
    const deckSegments = [
      { x0: 2.8, x1: -28, zMin: 714.5, zMax: 723.0, y0: 0.34, y1: 0.25 },
      { x0: -28, x1: -60, zMin: 714.5, zMax: 723.2, y0: 0.25, y1: 0.20 },
      { x0: -60, x1: -88, zMin: 714.5, zMax: 723.0, y0: 0.20, y1: 0.02 },
    ];

    deckSegments.forEach((seg, idx) => {
      const geo = new THREE.BufferGeometry();
      // Winding ordered for +Y upward normal: (-Z -> +Z) cross (-X)Wait: (-Z -> +Z) = (0,0,+dz) cross (-dx,0,0) = (0,-1,0),
      // so (-dx,0,0) cross (0,0,+dz) = (0,+1,0) -> (x0,zMin) -> (x1,zMin) -> (x0,zMax)!
      const positions = new Float32Array([
        seg.x0, seg.y0 + 0.015, seg.zMin,
        seg.x1, seg.y1 + 0.015, seg.zMin,
        seg.x0, seg.y0 + 0.015, seg.zMax,

        seg.x0, seg.y0 + 0.015, seg.zMax,
        seg.x1, seg.y1 + 0.015, seg.zMin,
        seg.x1, seg.y1 + 0.015, seg.zMax,
      ]);
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, colliderMat);
      mesh.name = `BridgeStaticCollider_Deck_${idx + 1}`;
      this.bridgeColliderGroup.add(mesh);
    });
  }

  /**
   * Indexes all solid obstacle triangles from `peijing` environment meshes into a fast 2D XZ spatial hash,
   * while extracting connected-component primitive bounds (cylinders/boxes) for debug wireframes & labeling.
   */
  private buildObstacleSpatialIndex(unclassifiedMeshes: string[]) {
    this.solidTriangles = [];
    this.spatialGrid.clear();
    this.obstacleColliders = [];

    let triId = 0;
    let primIdx = 0;

    for (const mesh of this.environmentMeshes) {
      const geom = mesh.geometry;
      const posAttr = geom?.attributes?.position;
      if (!posAttr) continue;

      const indexAttr = geom.index;
      const triCount = indexAttr ? Math.floor(indexAttr.count / 3) : Math.floor(posAttr.count / 3);
      if (triCount === 0) continue;

      // Connected components via vertex welding (quantized to 1cm world precision)
      const parent = new Int32Array(posAttr.count);
      for (let i = 0; i < posAttr.count; i++) parent[i] = i;

      const find = (x: number): number => {
        while (parent[x] !== x) {
          parent[x] = parent[parent[x]];
          x = parent[x];
        }
        return x;
      };
      const union = (a: number, b: number) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent[ra] = rb;
      };

      // World-space vertex cache for this mesh
      const worldVerts = new Float32Array(posAttr.count * 3);
      const weldMap = new Map<string, number>();

      for (let v = 0; v < posAttr.count; v++) {
        _vA.fromBufferAttribute(posAttr, v).applyMatrix4(mesh.matrixWorld);
        worldVerts[v * 3] = _vA.x;
        worldVerts[v * 3 + 1] = _vA.y;
        worldVerts[v * 3 + 2] = _vA.z;

        const wk = `${Math.round(_vA.x * 100)}_${Math.round(_vA.y * 100)}_${Math.round(_vA.z * 100)}`;
        const existing = weldMap.get(wk);
        if (existing !== undefined) {
          union(existing, v);
        } else {
          weldMap.set(wk, v);
        }
      }

      for (let t = 0; t < triCount; t++) {
        const i0 = indexAttr ? indexAttr.getX(t * 3) : t * 3;
        const i1 = indexAttr ? indexAttr.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = indexAttr ? indexAttr.getX(t * 3 + 2) : t * 3 + 2;
        union(i0, i1);
        union(i1, i2);
      }

      // Compute full component bounding boxes to ignore tiny ankle-level grass tuft cards & overhead-only props
      interface CompMeta {
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
        minZ: number;
        maxZ: number;
        triCount: number;
        // Torso-band bounds [minY + 0.15 .. minY + 2.4] for accurate tree-trunk / boulder box shape
        baseMinX: number;
        baseMaxX: number;
        baseMinZ: number;
        baseMaxZ: number;
        hasBaseTris: boolean;
      }

      const compStats = new Map<number, CompMeta>();
      for (let t = 0; t < triCount; t++) {
        const i0 = indexAttr ? indexAttr.getX(t * 3) : t * 3;
        const i1 = indexAttr ? indexAttr.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = indexAttr ? indexAttr.getX(t * 3 + 2) : t * 3 + 2;
        const root = find(i0);

        let meta = compStats.get(root);
        if (!meta) {
          meta = {
            minX: Infinity,
            maxX: -Infinity,
            minY: Infinity,
            maxY: -Infinity,
            minZ: Infinity,
            maxZ: -Infinity,
            triCount: 0,
            baseMinX: Infinity,
            baseMaxX: -Infinity,
            baseMinZ: Infinity,
            baseMaxZ: -Infinity,
            hasBaseTris: false,
          };
          compStats.set(root, meta);
        }
        meta.triCount++;

        for (const vi of [i0, i1, i2]) {
          const vx = worldVerts[vi * 3];
          const vy = worldVerts[vi * 3 + 1];
          const vz = worldVerts[vi * 3 + 2];
          if (vx < meta.minX) meta.minX = vx;
          if (vx > meta.maxX) meta.maxX = vx;
          if (vy < meta.minY) meta.minY = vy;
          if (vy > meta.maxY) meta.maxY = vy;
          if (vz < meta.minZ) meta.minZ = vz;
          if (vz > meta.maxZ) meta.maxZ = vz;
        }
      }

      // Second pass on vertices to capture torso-slice width (distinguishes tree trunks from wide overhead canopies)
      for (let v = 0; v < posAttr.count; v++) {
        const root = find(v);
        const meta = compStats.get(root);
        if (!meta) continue;
        const vy = worldVerts[v * 3 + 1];
        if (vy >= meta.minY + 0.12 && vy <= meta.minY + 2.2) {
          const vx = worldVerts[v * 3];
          const vz = worldVerts[v * 3 + 2];
          if (vx < meta.baseMinX) meta.baseMinX = vx;
          if (vx > meta.baseMaxX) meta.baseMaxX = vx;
          if (vz < meta.baseMinZ) meta.baseMinZ = vz;
          if (vz > meta.baseMaxZ) meta.baseMaxZ = vz;
          meta.hasBaseTris = true;
        }
      }

      // Generate human-readable ObstacleCollider descriptors for ground-level props (used for labels & debug draw)
      const compLabelMap = new Map<number, { label: string; colliderId: string }>();
      compStats.forEach((meta, root) => {
        const height = meta.maxY - meta.minY;
        const isTinyTuft = height < 0.45 && meta.triCount < 16;
        const isSkyProp = meta.minY > 14.0;
        if (isTinyTuft || isSkyProp) {
          compLabelMap.set(root, { label: '__SKIP__', colliderId: '__SKIP__' });
          return;
        }

        const bw = meta.hasBaseTris ? meta.baseMaxX - meta.baseMinX : meta.maxX - meta.minX;
        const bd = meta.hasBaseTris ? meta.baseMaxZ - meta.baseMinZ : meta.maxZ - meta.minZ;
        const cx = meta.hasBaseTris ? (meta.baseMinX + meta.baseMaxX) * 0.5 : (meta.minX + meta.maxX) * 0.5;
        const cz = meta.hasBaseTris ? (meta.baseMinZ + meta.baseMaxZ) * 0.5 : (meta.minZ + meta.maxZ) * 0.5;

        let label = 'Batu / Karang';
        let shape: 'cylinder' | 'box' = 'box';

        const isFinishShipPart =
          cx >= FINISH_SHIP_AREA.shipHullBounds.minX &&
          cx <= FINISH_SHIP_AREA.shipHullBounds.maxX &&
          cz >= FINISH_SHIP_AREA.shipHullBounds.minZ &&
          cz <= FINISH_SHIP_AREA.shipHullBounds.maxZ &&
          meta.maxY > 2.2;

        if (isFinishShipPart) {
          label = 'Kapal Finish';
          shape = 'box';
        } else if (height > 4.0 && bw < 3.5 && bd < 3.5) {
          label = 'Pohon / Batang';
          shape = 'cylinder';
        } else if (bw > 18 || bd > 18 || height > 12) {
          label = 'Tebing / Struktur Map';
          shape = 'box';
        } else if (Math.max(bw, bd) / Math.max(0.25, Math.min(bw, bd)) > 2.2) {
          label = 'Dinding / Pagar Kayu';
          shape = 'box';
        } else if (bw < 1.8 && bd < 1.8 && height >= 1.5) {
          label = 'Pilar / Tiang';
          shape = 'cylinder';
        }

        const colliderId = `${mesh.name || 'peijing'}#comp-${root}`;
        compLabelMap.set(root, { label, colliderId });

        // Store compact debug primitive (avoid giant sprawling L-shaped backdrop boxes in wireframe clutter if > 32m)
        if (bw > 0.15 && bd > 0.15 && Math.max(bw, bd) < 32) {
          primIdx++;
          this.obstacleColliders.push({
            id: `obs-${primIdx}`,
            shape,
            label,
            x: cx,
            z: cz,
            minY: meta.minY,
            maxY: Math.min(meta.maxY, meta.minY + 3.2),
            radius: shape === 'cylinder' ? Math.max(0.28, Math.min(bw, bd) * 0.5) : undefined,
            halfX: shape === 'box' ? bw * 0.5 : undefined,
            halfZ: shape === 'box' ? bd * 0.5 : undefined,
          });
        }
      });

      // Index individual solid triangles touching navigable world elevation band [-2m .. +16m]
      for (let t = 0; t < triCount; t++) {
        const i0 = indexAttr ? indexAttr.getX(t * 3) : t * 3;
        const i1 = indexAttr ? indexAttr.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = indexAttr ? indexAttr.getX(t * 3 + 2) : t * 3 + 2;
        const root = find(i0);
        const compInfo = compLabelMap.get(root);
        const label = compInfo?.label || 'Obstacle';
        if (label === '__SKIP__') continue;
        const colliderId = compInfo?.colliderId || `${mesh.name || 'peijing'}#comp-${root}`;

        const ax = worldVerts[i0 * 3];
        const ay = worldVerts[i0 * 3 + 1];
        const az = worldVerts[i0 * 3 + 2];
        const bx = worldVerts[i1 * 3];
        const by = worldVerts[i1 * 3 + 1];
        const bz = worldVerts[i1 * 3 + 2];
        const cx = worldVerts[i2 * 3];
        const cy = worldVerts[i2 * 3 + 1];
        const cz = worldVerts[i2 * 3 + 2];

        const minY = Math.min(ay, by, cy);
        const maxY = Math.max(ay, by, cy);
        // Only triangles that could possibly intersect player body height band [-2..16m]
        if (maxY < -2.0 || minY > 16.0) continue;

        _vA.set(ax, ay, az);
        _vB.set(bx, by, bz);
        _vC.set(cx, cy, cz);
        _e1.subVectors(_vB, _vA);
        _e2.subVectors(_vC, _vA);
        _triNormal.crossVectors(_e1, _e2);
        const lenSq = _triNormal.lengthSq();
        if (lenSq < 1e-8) continue;
        _triNormal.multiplyScalar(1 / Math.sqrt(lenSq));

        const minX = Math.min(ax, bx, cx);
        const maxX = Math.max(ax, bx, cx);
        const minZ = Math.min(az, bz, cz);
        const maxZ = Math.max(az, bz, cz);

        const solidTri: SolidTriangle = {
          id: triId++,
          ax,
          ay,
          az,
          bx,
          by,
          bz,
          cx,
          cy,
          cz,
          minX,
          maxX,
          minY,
          maxY,
          minZ,
          maxZ,
          nx: _triNormal.x,
          ny: _triNormal.y,
          nz: _triNormal.z,
          label,
          colliderId,
        };
        this.solidTriangles.push(solidTri);

        const gxMin = Math.floor(minX / SPATIAL_CELL_SIZE);
        const gxMax = Math.floor(maxX / SPATIAL_CELL_SIZE);
        const gzMin = Math.floor(minZ / SPATIAL_CELL_SIZE);
        const gzMax = Math.floor(maxZ / SPATIAL_CELL_SIZE);

        for (let gx = gxMin; gx <= gxMax; gx++) {
          for (let gz = gzMin; gz <= gzMax; gz++) {
            const key = cellKey(gx, gz);
            let bucket = this.spatialGrid.get(key);
            if (!bucket) {
              bucket = [];
              this.spatialGrid.set(key, bucket);
            }
            bucket.push(solidTri);
          }
        }
      }
    }

    this.triQueryStamp = new Int32Array(this.solidTriangles.length);
    this.collisionStats = {
      solidObstacleTriangles: this.solidTriangles.length,
      indexedGridCells: this.spatialGrid.size,
      obstaclePrimitivesCount: this.obstacleColliders.length,
      unclassifiedMeshes,
    };
  }

  /**
   * Builds merged wireframe visualizers in debugObstacleWireframes (strictly hidden unless debugMode === true).
   */
  private buildDebugWireframes() {
    this.debugObstacleWireframes.clear();

    const linePositions: number[] = [];
    const shipLinePositions: number[] = [];
    const pushSeg = (target: number[], x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => {
      target.push(x1, y1, z1, x2, y2, z2);
    };

    // Obstacle primitives wireframe (trees/pillars as octagon cylinders, rocks/walls/ship hull as boxes)
    for (const obs of this.obstacleColliders) {
      const y0 = Math.max(-0.5, obs.minY + 0.05);
      const y1 = Math.min(obs.maxY, y0 + 2.4);
      const dest = obs.label === 'Kapal Finish' ? shipLinePositions : linePositions;

      if (obs.shape === 'cylinder' && obs.radius) {
        const segs = 10;
        const r = obs.radius;
        for (let i = 0; i < segs; i++) {
          const a0 = (i / segs) * Math.PI * 2;
          const a1 = ((i + 1) / segs) * Math.PI * 2;
          const x0 = obs.x + Math.cos(a0) * r;
          const z0 = obs.z + Math.sin(a0) * r;
          const x1 = obs.x + Math.cos(a1) * r;
          const z1 = obs.z + Math.sin(a1) * r;
          pushSeg(dest, x0, y0, z0, x1, y0, z1);
          pushSeg(dest, x0, y1, z0, x1, y1, z1);
          if (i % 2 === 0) pushSeg(dest, x0, y0, z0, x0, y1, z0);
        }
      } else if (obs.halfX && obs.halfZ) {
        const minX = obs.x - obs.halfX;
        const maxX = obs.x + obs.halfX;
        const minZ = obs.z - obs.halfZ;
        const maxZ = obs.z + obs.halfZ;
        pushSeg(dest, minX, y0, minZ, maxX, y0, minZ);
        pushSeg(dest, maxX, y0, minZ, maxX, y0, maxZ);
        pushSeg(dest, maxX, y0, maxZ, minX, y0, maxZ);
        pushSeg(dest, minX, y0, maxZ, minX, y0, minZ);

        pushSeg(dest, minX, y1, minZ, maxX, y1, minZ);
        pushSeg(dest, maxX, y1, minZ, maxX, y1, maxZ);
        pushSeg(dest, maxX, y1, maxZ, minX, y1, maxZ);
        pushSeg(dest, minX, y1, maxZ, minX, y1, minZ);

        pushSeg(dest, minX, y0, minZ, minX, y1, minZ);
        pushSeg(dest, maxX, y0, minZ, maxX, y1, minZ);
        pushSeg(dest, maxX, y0, maxZ, maxX, y1, maxZ);
        pushSeg(dest, minX, y0, maxZ, minX, y1, maxZ);
      }
    }

    if (linePositions.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0xf97316, // Vivid orange obstacle collider bounds
        transparent: true,
        opacity: 0.75,
      });
      const segments = new THREE.LineSegments(geo, mat);
      segments.name = 'DebugObstacleWireframes';
      this.debugObstacleWireframes.add(segments);
    }

    // Distinct Magenta/Purple Wireframe for Finish Ship Solid Colliders
    if (shipLinePositions.length > 0) {
      const shipGeo = new THREE.BufferGeometry();
      shipGeo.setAttribute('position', new THREE.Float32BufferAttribute(shipLinePositions, 3));
      const shipMat = new THREE.LineBasicMaterial({
        color: 0xe879f9,
        transparent: true,
        opacity: 0.9,
      });
      const shipSegs = new THREE.LineSegments(shipGeo, shipMat);
      shipSegs.name = 'DebugFinishShipColliders';
      this.debugObstacleWireframes.add(shipSegs);
    }

    // Open Walkable Finish Corridor Strip (Emerald Green) from bridge exit to Finish Ship dock
    const accessLines: number[] = [];
    const ec = FINISH_SHIP_AREA.entryCorridorBounds;
    pushSeg(accessLines, ec.minX, 0.35, ec.minZ, ec.maxX, 0.35, ec.minZ);
    pushSeg(accessLines, ec.maxX, 0.35, ec.minZ, ec.maxX, 1.35, ec.maxZ);
    pushSeg(accessLines, ec.maxX, 1.35, ec.maxZ, ec.minX, 1.35, ec.maxZ);
    pushSeg(accessLines, ec.minX, 1.35, ec.maxZ, ec.minX, 0.35, ec.minZ);
    const accessGeo = new THREE.BufferGeometry();
    accessGeo.setAttribute('position', new THREE.Float32BufferAttribute(accessLines, 3));
    const accessMat = new THREE.LineBasicMaterial({ color: 0x10b981 });
    const accessSegs = new THREE.LineSegments(accessGeo, accessMat);
    accessSegs.name = 'DebugFinishOpenPath';
    this.debugObstacleWireframes.add(accessSegs);

    // Non-Solid Finish Trigger Zone Cylinder (Cyan)
    const trigLines: number[] = [];
    const tc = FINISH_SHIP_AREA.triggerCenter;
    const tr = FINISH_SHIP_AREA.triggerRadius;
    const trigGround = this.queryGroundSurface(tc.x, tc.z, 1.0);
    const ty0 = (trigGround.hit ? trigGround.y : 0.98) + 0.08;
    const ty1 = ty0 + 2.6;
    const tSegs = 24;
    for (let i = 0; i < tSegs; i++) {
      const a0 = (i / tSegs) * Math.PI * 2;
      const a1 = ((i + 1) / tSegs) * Math.PI * 2;
      const x0 = tc.x + Math.cos(a0) * tr;
      const z0 = tc.z + Math.sin(a0) * tr;
      const x1 = tc.x + Math.cos(a1) * tr;
      const z1 = tc.z + Math.sin(a1) * tr;
      pushSeg(trigLines, x0, ty0, z0, x1, ty0, z1);
      pushSeg(trigLines, x0, ty1, z0, x1, ty1, z1);
      if (i % 3 === 0) pushSeg(trigLines, x0, ty0, z0, x0, ty1, z0);
    }
    const trigGeo = new THREE.BufferGeometry();
    trigGeo.setAttribute('position', new THREE.Float32BufferAttribute(trigLines, 3));
    const trigMat = new THREE.LineBasicMaterial({ color: 0x22d3ee });
    const trigSegs = new THREE.LineSegments(trigGeo, trigMat);
    trigSegs.name = 'DebugFinishTriggerZone';
    this.debugObstacleWireframes.add(trigSegs);

    // Bridge & Sea Cove/Map Boundary Safety Rail Wireframes (Red)
    const boundaryLines: number[] = [];
    const pushBound = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => {
      boundaryLines.push(x1, y1, z1, x2, y2, z2);
    };
    // Straight bridge edges
    pushBound(-4.6, 0.3, 630, -4.6, 0.3, 704);
    pushBound(4.6, 0.3, 630, 4.6, 0.3, 704);
    // South edge of horizontal bridge deck & east chasm drop
    pushBound(-88, 0.4, 714.5, -2, 0.4, 714.5);
    pushBound(-71, 0.4, 723.2, -2, 0.4, 723.2);
    // Forbidden sea cove shoreline east of Finish beach & north outer boundary
    pushBound(-70, 0.4, 724.0, -68, 0.8, 765.0);
    pushBound(-91, 2.0, 777.0, -35, 2.0, 777.0);
    // South spawn border
    pushBound(-100, 0.3, 1.5, 100, 0.3, 1.5);

    const boundGeo = new THREE.BufferGeometry();
    boundGeo.setAttribute('position', new THREE.Float32BufferAttribute(boundaryLines, 3));
    const boundMat = new THREE.LineBasicMaterial({ color: 0xef4444 });
    const boundSegs = new THREE.LineSegments(boundGeo, boundMat);
    boundSegs.name = 'DebugForbiddenBoundaries';
    this.debugObstacleWireframes.add(boundSegs);
  }

  /**
   * Strict ground & surface classification query at (x, z).
   * Explicitly distinguishes road, wooden bridge, sand/land vs water_shore, chasm_void, steep_cliff, and map_boundary.
   * NEVER fabricates a fake y=0 floor over empty void/water!
   */
  public queryGroundSurface(x: number, z: number, currentY: number = 0): GroundSurfaceResult {
    // 1. Explicit outer map bounds check (extended north to Z=778 to cover Finish beach & Pirate Ship cove)
    if (z < 1.5 || z > 778.0 || x < -134.0 || x > 134.0) {
      return {
        y: currentY,
        hit: false,
        walkable: false,
        meshName: 'MapOuterBoundary',
        isOnBridge: false,
        slopeNormalY: 0,
        category: 'map_boundary',
      };
    }

    // Bridge starts cleanly at Z=630.0 where main road (hw_zhidao210_daolu_03) ends,
    // with BridgeStaticCollider_Approach_1 overlapping seamlessly from Z=629.6 to 660.0!
    const isInBridgeZone = z >= 630.0;
    const rayOriginY = currentY > -15 ? currentY + 2.8 : 14.0;
    _rayOrigin.set(x, rayOriginY, z);
    this.raycaster.set(_rayOrigin, _downVec);
    this.raycaster.far = isInBridgeZone ? 16.0 : 40.0;

    // 2. Bridge & West Finish Shore / Ship Cove Zone (Z >= 629)
    if (isInBridgeZone) {
      // Static tightened bridge deck colliders first
      if (this.bridgeColliderGroup.children.length > 0) {
        const bColHits = this.raycaster.intersectObjects(this.bridgeColliderGroup.children, true);
        if (bColHits.length > 0) {
          const hit = bColHits[0];
          return {
            y: hit.point.y,
            hit: true,
            walkable: true,
            meshName: hit.object.name,
            isOnBridge: true,
            slopeNormalY: 1.0,
            category: 'bridge',
          };
        }
      }

      // GLB bridge mesh fallback (strictly clamped to wooden deck altitude Y >= -0.55)
      if (this.bridgeMeshes.length > 0) {
        const bMeshHits = this.raycaster.intersectObjects(this.bridgeMeshes, true);
        for (const h of bMeshHits) {
          if (h.point.y > rayOriginY || h.point.y < -0.55) continue;
          let ny = 1.0;
          if (h.face) {
            _normalMat.getNormalMatrix(h.object.matrixWorld);
            _worldNorm.copy(h.face.normal).applyMatrix3(_normalMat).normalize();
            ny = _worldNorm.y;
          }
          if (ny >= this.config.maxWalkableSlope) {
            return {
              y: h.point.y,
              hit: true,
              walkable: true,
              meshName: h.object.name,
              isOnBridge: true,
              slopeNormalY: ny,
              category: 'bridge',
            };
          }
        }
      }

      // West Finish island shoreline & beach leading north alongside the Pirate Ship (X in [-91..-35], Z in [706..778])
      // Uses -0.68m coastal floor so bridge-to-beach transition seam at Z=724 (-0.39..-0.52m) is smoothly walkable,
      // while deeper cove water/ravine (Y < -0.68..-3.9m) and steep cliffs stay strictly blocked!
      if (x >= -91.0 && x <= -35.0 && z >= 706.0 && z <= 778.0 && this.westShoreMeshes.length > 0) {
        const shoreHits = this.raycaster.intersectObjects(this.westShoreMeshes, true);
        for (const h of shoreHits) {
          if (h.point.y > rayOriginY || h.point.y < -4.5) continue;
          let ny = 1.0;
          if (h.face) {
            _normalMat.getNormalMatrix(h.object.matrixWorld);
            _worldNorm.copy(h.face.normal).applyMatrix3(_normalMat).normalize();
            ny = _worldNorm.y;
          }
          const isWalkable = ny >= this.config.maxWalkableSlope && h.point.y >= -0.68;
          return {
            y: h.point.y,
            hit: true,
            walkable: isWalkable,
            meshName: h.object.name,
            isOnBridge: false,
            slopeNormalY: ny,
            category: isWalkable ? 'sand_land' : ny < this.config.maxWalkableSlope ? 'steep_cliff' : 'water_shore',
          };
        }
      }

      // Everything else inside Z >= 629 without deck support is chasm / ocean abyss
      return {
        y: currentY,
        hit: false,
        walkable: false,
        meshName: 'RavineChasmVoid',
        isOnBridge: false,
        slopeNormalY: 0,
        category: 'chasm_void',
      };
    }

    // 3. Main Island Zone (Z in [1.5 .. 629))
    if (this.walkableMeshes.length > 0) {
      const hits = this.raycaster.intersectObjects(this.walkableMeshes, true);
      for (const h of hits) {
        if (h.point.y > rayOriginY) continue;

        let ny = 1.0;
        if (h.face) {
          _normalMat.getNormalMatrix(h.object.matrixWorld);
          _worldNorm.copy(h.face.normal).applyMatrix3(_normalMat).normalize();
          ny = _worldNorm.y;
        }

        const isRoadMesh = h.object.name.includes('daolu');

        // Submerged coastal water depression check
        if (h.point.y <= this.config.waterLevelY) {
          return {
            y: h.point.y,
            hit: true,
            walkable: false,
            meshName: h.object.name,
            isOnBridge: false,
            slopeNormalY: ny,
            category: 'water_shore',
          };
        }

        // Too steep cliff face check
        if (ny < this.config.maxWalkableSlope) {
          return {
            y: h.point.y,
            hit: true,
            walkable: false,
            meshName: h.object.name,
            isOnBridge: false,
            slopeNormalY: ny,
            category: 'steep_cliff',
          };
        }

        return {
          y: h.point.y,
          hit: true,
          walkable: true,
          meshName: h.object.name,
          isOnBridge: false,
          slopeNormalY: ny,
          category: isRoadMesh ? 'road' : 'sand_land',
        };
      }
    }

    // No ground hit outside island perimeter (sea/skybox cliff void)
    return {
      y: currentY,
      hit: false,
      walkable: false,
      meshName: 'SeaVoidBoundary',
      isOnBridge: false,
      slopeNormalY: 0,
      category: 'water_shore',
    };
  }

  /**
   * Backwards-compatible ground query used by spawn & Finish monument.
   */
  public getGroundHeight(
    x: number,
    z: number,
    currentY: number = 0
  ): { y: number; hit: boolean; meshName: string; isOnBridge: boolean } {
    const res = this.queryGroundSurface(x, z, currentY);
    if (this.debugVisualGroup.visible && !res.hit) {
      // keep silent
    }
    return {
      y: res.y,
      hit: res.hit,
      meshName: res.meshName,
      isOnBridge: res.isOnBridge,
    };
  }

  /**
   * Checks whether (x, z) AND a small radial foot margin are safely walkable without
   * overhanging off cliffs, ocean shorelines, bridge edges, or map boundaries.
   */
  private isSafeFootprint(
    x: number,
    z: number,
    refY: number
  ): { ok: boolean; center: GroundSurfaceResult; failCategory: SurfaceCategory; failReason: string; failMeshName: string } {
    const center = this.queryGroundSurface(x, z, refY);
    if (!center.walkable) {
      return {
        ok: false,
        center,
        failCategory: center.category,
        failMeshName: center.meshName,
        failReason: `Permukaan tidak walkable (${center.category} @ ${center.meshName}, y=${center.y.toFixed(2)})`,
      };
    }

    // Step height limit (prevents walking straight up vertical hill ledges)
    const stepDelta = center.y - refY;
    if (stepDelta > this.config.playerStepHeight) {
      return {
        ok: false,
        center,
        failCategory: 'steep_cliff',
        failMeshName: center.meshName,
        failReason: `Undakan terlalu tinggi (Δy=+${stepDelta.toFixed(2)}m > ${this.config.playerStepHeight}m)`,
      };
    }
    if (center.isOnBridge && stepDelta < -1.35) {
      return {
        ok: false,
        center,
        failCategory: 'chasm_void',
        failMeshName: center.meshName,
        failReason: `Penurunan ekstrem jembatan (Δy=${stepDelta.toFixed(2)}m)`,
      };
    }

    // Perimeter margin probes around player capsule so shoes don't hang off ledges into water/abyss
    const m = Math.max(0.24, this.config.playerColliderRadius * 0.78);
    const offsets: Array<[number, number]> = [
      [m, 0],
      [-m, 0],
      [0, m],
      [0, -m],
    ];
    for (let i = 0; i < 4; i++) {
      const px = x + offsets[i][0];
      const pz = z + offsets[i][1];
      const p = this.queryGroundSurface(px, pz, center.y);
      if (!p.walkable) {
        return {
          ok: false,
          center,
          failCategory: p.category,
          failMeshName: p.meshName,
          failReason: `Tepi kaki mengenai ${p.category} (${p.meshName}) di (${px.toFixed(1)}, ${pz.toFixed(1)})`,
        };
      }
      if (center.isOnBridge && Math.abs(p.y - center.y) > 1.35) {
        return {
          ok: false,
          center,
          failCategory: 'chasm_void',
          failMeshName: p.meshName,
          failReason: `Tepi jembatan jurang di (${px.toFixed(1)}, ${pz.toFixed(1)})`,
        };
      }
    }

    return { ok: true, center, failCategory: center.category, failMeshName: center.meshName, failReason: 'OK' };
  }

  /**
   * Pushes candidate XZ position out of any overlapping solid triangles in the spatial hash
   * and chest cylinders, accumulating average collision pushout normal for smooth velocity sliding.
   */
  private pushOutSolidObstacles(
    px: number,
    pz: number,
    footY: number,
    chestColliders: ChestCollisionVolume[]
  ): {
    x: number;
    z: number;
    collided: boolean;
    normalX: number;
    normalZ: number;
    label?: string;
    colliderId?: string;
  } {
    const radius = this.config.playerColliderRadius;
    const rSq = radius * radius;
    const bodyLowY = footY + 0.62;
    const bodyHighY = footY + 1.28;
    const spineBottomClearance = bodyLowY - radius;
    const spineTopCeiling = bodyHighY + radius;

    let curX = px;
    let curZ = pz;
    let collided = false;
    let sumNx = 0;
    let sumNz = 0;
    let hitLabel: string | undefined;
    let hitColliderId: string | undefined;

    // 3 relaxation passes guarantee clean multi-wall corner & trunk-chest separation
    for (let iter = 0; iter < 3; iter++) {
      let iterPushed = false;

      // 1. Spatial-hashed GLB `peijing` environment triangles
      if (this.solidTriangles.length > 0) {
        this.currentQueryStamp++;
        if (this.currentQueryStamp >= 0x7ffffff0) {
          this.triQueryStamp.fill(0);
          this.currentQueryStamp = 1;
        }
        const stamp = this.currentQueryStamp;

        const pad = radius + 0.15;
        const gxMin = Math.floor((curX - pad) / SPATIAL_CELL_SIZE);
        const gxMax = Math.floor((curX + pad) / SPATIAL_CELL_SIZE);
        const gzMin = Math.floor((curZ - pad) / SPATIAL_CELL_SIZE);
        const gzMax = Math.floor((curZ + pad) / SPATIAL_CELL_SIZE);

        for (let gx = gxMin; gx <= gxMax; gx++) {
          for (let gz = gzMin; gz <= gzMax; gz++) {
            const bucket = this.spatialGrid.get(cellKey(gx, gz));
            if (!bucket) continue;

            for (let b = 0; b < bucket.length; b++) {
              const st = bucket[b];
              if (this.triQueryStamp[st.id] === stamp) continue;
              this.triQueryStamp[st.id] = stamp;

              // Fast AABB rejection
              if (st.maxY < spineBottomClearance || st.minY > spineTopCeiling) continue;
              if (
                st.maxX < curX - pad ||
                st.minX > curX + pad ||
                st.maxZ < curZ - pad ||
                st.minZ > curZ + pad
              ) {
                continue;
              }

              // Skip low flat walkable prop-bases under player's knees
              if (st.ny > 0.72 && st.maxY <= footY + this.config.playerStepHeight) continue;

              _tri.a.set(st.ax, st.ay, st.az);
              _tri.b.set(st.bx, st.by, st.bz);
              _tri.c.set(st.cx, st.cy, st.cz);

              // Test lower torso sphere and upper chest sphere along capsule spine
              for (let s = 0; s < 2; s++) {
                const sy = s === 0 ? bodyLowY : bodyHighY;
                _sphereCenter.set(curX, sy, curZ);
                _tri.closestPointToPoint(_sphereCenter, _closestPt);

                const dx = curX - _closestPt.x;
                const dy = sy - _closestPt.y;
                const dz = curZ - _closestPt.z;
                const distSq3 = dx * dx + dy * dy + dz * dz;

                if (distSq3 < rSq) {
                  const horizDistSq = dx * dx + dz * dz;
                  const dist3 = Math.sqrt(distSq3);
                  // Horizontal radius available at this vertical offset dy
                  const allowedHorizSq = Math.max(0, rSq - dy * dy);
                  const allowedHoriz = Math.sqrt(allowedHorizSq);

                  let nx = 0;
                  let nz = 0;
                  let pushAmount = 0;

                  if (horizDistSq > 1e-7) {
                    const horizDist = Math.sqrt(horizDistSq);
                    nx = dx / horizDist;
                    nz = dz / horizDist;
                    pushAmount = Math.max(0, allowedHoriz - horizDist);
                    if (pushAmount < 1e-4 && dist3 < radius) {
                      pushAmount = (radius - dist3) * 0.5;
                    }
                  } else {
                    // Center sits directly on/inside vertical edge — fall back to triangle horizontal normal
                    const triHorizLen = Math.hypot(st.nx, st.nz);
                    if (triHorizLen > 1e-4) {
                      nx = st.nx / triHorizLen;
                      nz = st.nz / triHorizLen;
                      pushAmount = radius * 0.5;
                    }
                  }

                  if (pushAmount > 1e-5) {
                    curX += nx * pushAmount;
                    curZ += nz * pushAmount;
                    sumNx += nx;
                    sumNz += nz;
                    collided = true;
                    iterPushed = true;
                    if (!hitLabel) {
                      hitLabel = st.label;
                      hitColliderId = st.colliderId;
                    }
                  }
                }
              }
            }
          }
        }
      }

      // 2. Treasure chest solid cylinders (prevents clipping inside chest mesh while leaving [E] aura passable)
      for (let c = 0; c < chestColliders.length; c++) {
        const chest = chestColliders[c];
        const minSep = radius + chest.radius;
        const dx = curX - chest.x;
        if (dx > minSep || dx < -minSep) continue;
        const dz = curZ - chest.z;
        if (dz > minSep || dz < -minSep) continue;
        if (Math.abs(chest.y - footY) > 1.35) continue;

        const distSq = dx * dx + dz * dz;

        if (distSq < minSep * minSep && distSq > 1e-8) {
          const dist = Math.sqrt(distSq);
          const nx = dx / dist;
          const nz = dz / dist;
          const push = minSep - dist;
          curX += nx * push;
          curZ += nz * push;
          sumNx += nx;
          sumNz += nz;
          collided = true;
          iterPushed = true;
          if (!hitLabel) {
            hitLabel = 'Peti Harta Karun';
            hitColliderId = chest.id;
          }
        }
      }

      if (!iterPushed) break;
    }

    const nLen = Math.hypot(sumNx, sumNz);
    return {
      x: curX,
      z: curZ,
      collided,
      normalX: nLen > 1e-5 ? sumNx / nLen : 0,
      normalZ: nLen > 1e-5 ? sumNz / nLen : 0,
      label: hitLabel,
      colliderId: hitColliderId,
    };
  }

  /**
   * Resolves a horizontal movement step from (currentPos) to (desiredX, desiredZ) with:
   * 1. Solid obstacle pushout + smooth wall/trunk sliding
   * 2. Walkable ground / shoreline / water / bridge railing / map boundary check with smooth coastline sliding
   * 3. Velocity tangent projection so diagonal collisions glide instead of stopping dead or jittering
   */
  public resolveCapsuleMovement(
    currentPos: THREE.Vector3,
    desiredX: number,
    desiredZ: number,
    velocity: THREE.Vector3,
    chestColliders: ChestCollisionVolume[] = []
  ): CapsuleResolutionResult {
    const startX = currentPos.x;
    const startZ = currentPos.z;
    const footY = currentPos.y;

    // A. Solid Obstacle & Chest Pushout on candidate position
    const obs = this.pushOutSolidObstacles(desiredX, desiredZ, footY, chestColliders);
    let candX = obs.x;
    let candZ = obs.z;

    if (obs.collided && (obs.normalX !== 0 || obs.normalZ !== 0)) {
      const vDotN = velocity.x * obs.normalX + velocity.z * obs.normalZ;
      if (vDotN < 0) {
        velocity.x -= vDotN * obs.normalX;
        velocity.z -= vDotN * obs.normalZ;
      }
    }

    // B. Walkable Ground / Shoreline / Water / Bridge Railing / Map Border validation
    let footCheck = this.isSafeFootprint(candX, candZ, footY);
    let hitBoundary = false;

    if (!footCheck.ok) {
      hitBoundary = true;
      const failCat = footCheck.failCategory;

      // Estimate local walkable boundary inward normal using 8 radial probes around current safe position
      let bNx = 0;
      let bNz = 0;
      const probeDist = 0.55;
      for (let i = 0; i < 8; i++) {
        const ang = (i * Math.PI) / 4;
        const px = startX + Math.cos(ang) * probeDist;
        const pz = startZ + Math.sin(ang) * probeDist;
        const probe = this.queryGroundSurface(px, pz, footY);
        if (
          probe.walkable &&
          probe.y - footY <= this.config.playerStepHeight &&
          (!probe.isOnBridge || probe.y - footY >= -1.35)
        ) {
          bNx += Math.cos(ang);
          bNz += Math.sin(ang);
        }
      }

      const bLen = Math.hypot(bNx, bNz);
      if (bLen > 1e-4) {
        bNx /= bLen;
        bNz /= bLen;

        // Project requested move delta onto shoreline/boundary tangent so player glides smoothly along edge!
        const moveDx = candX - startX;
        const moveDz = candZ - startZ;
        const moveDotB = moveDx * bNx + moveDz * bNz;
        const slideDx = moveDotB < 0 ? moveDx - moveDotB * bNx : moveDx;
        const slideDz = moveDotB < 0 ? moveDz - moveDotB * bNz : moveDz;

        // Also damp outward velocity along boundary normal
        const velDotB = velocity.x * bNx + velocity.z * bNz;
        if (velDotB < 0) {
          velocity.x -= velDotB * bNx;
          velocity.z -= velDotB * bNz;
        }

        // Test tangent slide (and with a slight inward bias if curved shoreline hugs the margin)
        let slideAccepted = false;
        for (const inwardBias of [0.0, 0.04, 0.09]) {
          const slideObs = this.pushOutSolidObstacles(
            startX + slideDx + bNx * inwardBias,
            startZ + slideDz + bNz * inwardBias,
            footY,
            chestColliders
          );
          const slideCheck = this.isSafeFootprint(slideObs.x, slideObs.z, footY);
          if (slideCheck.ok) {
            candX = slideObs.x;
            candZ = slideObs.z;
            footCheck = slideCheck;
            slideAccepted = true;
            break;
          }
        }

        if (!slideAccepted) {
          // Stay cleanly inside safe current position
          const stayCheck = this.isSafeFootprint(startX, startZ, footY);
          candX = startX;
          candZ = startZ;
          footCheck = stayCheck.ok ? stayCheck : footCheck;
          velocity.x *= 0.25;
          velocity.z *= 0.25;
        }
      } else {
        candX = startX;
        candZ = startZ;
        footCheck = this.isSafeFootprint(startX, startZ, footY);
        velocity.x = 0;
        velocity.z = 0;
      }

      const reportCategory = failCat;
      const finalGround = this.queryGroundSurface(candX, candZ, footY);
      const validY = finalGround.walkable ? finalGround.y : footY;
      this.latestDebugData.surfaceCategory = reportCategory;

      if (this.debugVisualGroup.visible || this.config.debugMode) {
        const reason = footCheck.failReason;
        const blockerId = obs.collided ? (obs.colliderId || obs.label) : footCheck.failMeshName;
        this.updateDebugDataInPlace(
          candX,
          validY + 2.8,
          candZ,
          finalGround.hit ? _dbgHitVec.set(candX, finalGround.y, candZ) : null,
          finalGround.meshName,
          validY,
          finalGround.isOnBridge,
          finalGround.hit ? 1 : 0,
          reportCategory,
          obs.collided,
          true,
          obs.label,
          startX,
          footY,
          startZ,
          desiredX,
          desiredZ,
          finalGround.walkable,
          blockerId,
          reason
        );
      }

      return {
        x: candX,
        z: candZ,
        groundY: validY,
        grounded: finalGround.walkable,
        isOnBridge: finalGround.isOnBridge,
        surfaceCategory: reportCategory,
        collidedObstacle: obs.collided,
        hitBoundary: true,
        obstacleLabel: obs.label,
      };
    }

    // Valid walkable result
    const finalSurface = footCheck.center;
    this.latestDebugData.surfaceCategory = finalSurface.category;

    if (this.debugVisualGroup.visible || this.config.debugMode) {
      const reason = obs.collided
        ? `Sliding di samping ${obs.label || 'Obstacle'} (${obs.colliderId || 'mesh'})`
        : 'OK (Walkable clear)';

      this.updateDebugDataInPlace(
        candX,
        finalSurface.y + 2.8,
        candZ,
        finalSurface.hit ? _dbgHitVec.set(candX, finalSurface.y, candZ) : null,
        finalSurface.meshName,
        finalSurface.y,
        finalSurface.isOnBridge,
        finalSurface.hit ? 1 : 0,
        finalSurface.category,
        obs.collided,
        hitBoundary,
        obs.label,
        startX,
        footY,
        startZ,
        desiredX,
        desiredZ,
        finalSurface.walkable,
        obs.colliderId,
        reason
      );
    }

    return {
      x: candX,
      z: candZ,
      groundY: finalSurface.y,
      grounded: finalSurface.walkable,
      isOnBridge: finalSurface.isOnBridge,
      surfaceCategory: finalSurface.category,
      collidedObstacle: obs.collided,
      hitBoundary,
      obstacleLabel: obs.label,
    };
  }

  /**
   * Updates real-time debug visualizers and telemetry in-place (Zero per-frame Vector3 allocations).
   */
  private updateDebugDataInPlace(
    rayX: number,
    rayY: number,
    rayZ: number,
    hitPoint: THREE.Vector3 | null,
    meshName: string,
    surfaceY: number,
    isOnBridge: boolean,
    totalHits: number,
    surfaceCategory: SurfaceCategory,
    isCollidingObstacle: boolean,
    isAtBoundary: boolean,
    collidingObstacleLabel: string | undefined,
    prevX: number,
    prevY: number,
    prevZ: number,
    desiredX: number,
    desiredZ: number,
    isWalkableSurface: boolean,
    blockingColliderId: string | undefined,
    blockingReason: string
  ) {
    const finishDist = Math.hypot(
      rayX - FINISH_SHIP_AREA.triggerCenter.x,
      rayZ - FINISH_SHIP_AREA.triggerCenter.z
    );
    const d = this.latestDebugData;
    d.footPos.x = rayX;
    d.footPos.y = hitPoint ? hitPoint.y : surfaceY;
    d.footPos.z = rayZ;
    d.prevPos.x = prevX;
    d.prevPos.y = prevY;
    d.prevPos.z = prevZ;
    d.desiredPos.x = desiredX;
    d.desiredPos.y = prevY;
    d.desiredPos.z = desiredZ;
    d.rayOrigin.x = rayX;
    d.rayOrigin.y = rayY;
    d.rayOrigin.z = rayZ;
    if (hitPoint) {
      if (!d.hitPoint) {
        d.hitPoint = { x: hitPoint.x, y: hitPoint.y, z: hitPoint.z };
      } else {
        d.hitPoint.x = hitPoint.x;
        d.hitPoint.y = hitPoint.y;
        d.hitPoint.z = hitPoint.z;
      }
    } else {
      d.hitPoint = null;
    }
    d.detectedMeshName = meshName;
    d.usedSurfaceHeight = Number(surfaceY.toFixed(3));
    d.isGrounded = true;
    d.isOnBridge = isOnBridge;
    d.totalHits = totalHits;
    d.surfaceCategory = surfaceCategory;
    d.isWalkableSurface = isWalkableSurface;
    d.isCollidingObstacle = isCollidingObstacle;
    d.isAtBoundary = isAtBoundary;
    d.collidingObstacleLabel = collidingObstacleLabel;
    d.blockingColliderId = blockingColliderId;
    d.blockingReason = blockingReason;
    d.playerColliderRadius = this.config.playerColliderRadius;
    d.playerColliderHeight = this.config.playerColliderHeight;
    d.finishDistance = Number(finishDist.toFixed(2));
    d.isInsideFinishZone = finishDist <= FINISH_SHIP_AREA.triggerRadius;
    d.stats = this.collisionStats;

    if (this.debugVisualGroup.visible) {
      this.debugFootMarker.position.set(rayX, surfaceY, rayZ);
      if (hitPoint) {
        this.debugHitMarker.position.copy(hitPoint);
        const posAttr = this.debugRayLine.geometry.getAttribute('position') as THREE.BufferAttribute;
        if (posAttr) {
          posAttr.setXYZ(0, rayX, rayY, rayZ);
          posAttr.setXYZ(1, hitPoint.x, hitPoint.y, hitPoint.z);
          posAttr.needsUpdate = true;
        }
      }
    }
  }

  /**
   * Evaluates obstacle clearance & nearest prop distance in O(1) using the pre-built 2m spatial grid
   * instead of firing 30+ full-mesh raycasts against environmentMeshes per candidate.
   */
  private querySpatialChestClearance(
    cx: number,
    groundY: number,
    cz: number
  ): { obstacleClearanceOk: boolean; nearestPropDistance: number | null } {
    if (this.solidTriangles.length === 0) {
      return { obstacleClearanceOk: true, nearestPropDistance: null };
    }

    this.currentQueryStamp++;
    if (this.currentQueryStamp >= 0x7ffffff0) {
      this.triQueryStamp.fill(0);
      this.currentQueryStamp = 1;
    }
    const stamp = this.currentQueryStamp;

    const searchRadius = 4.55;
    const gxMin = Math.floor((cx - searchRadius) / SPATIAL_CELL_SIZE);
    const gxMax = Math.floor((cx + searchRadius) / SPATIAL_CELL_SIZE);
    const gzMin = Math.floor((cz - searchRadius) / SPATIAL_CELL_SIZE);
    const gzMax = Math.floor((cz + searchRadius) / SPATIAL_CELL_SIZE);

    const clearMinY = groundY + 0.05;
    const clearMaxY = groundY + 2.4;
    const testHeights = [groundY + 0.35, groundY + 0.85];
    let obstacleClearanceOk = true;
    let minPropSq = 4.5 * 4.5;

    for (let gx = gxMin; gx <= gxMax; gx++) {
      for (let gz = gzMin; gz <= gzMax; gz++) {
        const bucket = this.spatialGrid.get(cellKey(gx, gz));
        if (!bucket) continue;

        for (let b = 0; b < bucket.length; b++) {
          const st = bucket[b];
          if (this.triQueryStamp[st.id] === stamp) continue;
          this.triQueryStamp[st.id] = stamp;

          if (st.maxY <= clearMinY || st.minY >= clearMaxY) continue;
          if (
            st.maxX < cx - searchRadius ||
            st.minX > cx + searchRadius ||
            st.maxZ < cz - searchRadius ||
            st.minZ > cz + searchRadius
          ) {
            continue;
          }

          _tri.a.set(st.ax, st.ay, st.az);
          _tri.b.set(st.bx, st.by, st.bz);
          _tri.c.set(st.cx, st.cy, st.cz);

          if (obstacleClearanceOk) {
            for (let h = 0; h < testHeights.length; h++) {
              _sphereCenter.set(cx, testHeights[h], cz);
              _tri.closestPointToPoint(_sphereCenter, _closestPt);
              const dx = _closestPt.x - cx;
              const dz = _closestPt.z - cz;
              const dy = Math.abs(_closestPt.y - testHeights[h]);
              if (dy <= 0.52 && dx * dx + dz * dz < 1.15 * 1.15) {
                obstacleClearanceOk = false;
                break;
              }
            }

            if (obstacleClearanceOk) {
              _sphereCenter.set(cx, groundY + 1.25, cz);
              _tri.closestPointToPoint(_sphereCenter, _closestPt);
              if (_closestPt.y > clearMinY && _closestPt.y < clearMaxY) {
                const dx = _closestPt.x - cx;
                const dz = _closestPt.z - cz;
                if (dx * dx + dz * dz <= 0.82 * 0.82) {
                  obstacleClearanceOk = false;
                }
              }
            }
          }

          if (st.maxY >= groundY + 0.25 && st.minY <= groundY + 1.6) {
            _sphereCenter.set(cx, groundY + 0.75, cz);
            _tri.closestPointToPoint(_sphereCenter, _closestPt);
            if (Math.abs(_closestPt.y - (groundY + 0.75)) <= 0.95) {
              const dx = _closestPt.x - cx;
              const dz = _closestPt.z - cz;
              const dSq = dx * dx + dz * dz;
              if (dSq < minPropSq) {
                minPropSq = dSq;
              }
            }
          }
        }
      }
    }

    return {
      obstacleClearanceOk,
      nearestPropDistance: minPropSq < 4.5 * 4.5 ? Number(Math.sqrt(minPropSq).toFixed(2)) : null,
    };
  }

  /**
   * Validates & ground-snaps a candidate chest placement onto walkable terrain/bridge
   * with peijing clearance and gradual reachability from the main adventure route.
   */
  public validateChestPlacement(
    targetX: number,
    targetZ: number,
    fallbackY: number,
    zoneType: ChestZoneType,
    occupiedPositions: Array<{ x: number; z: number }> = []
  ): ChestPlacementMeta {
    const evaluateCandidate = (cx: number, cz: number): ChestPlacementMeta => {
      const tooCloseToOther = occupiedPositions.some((p) => {
        const dx = p.x - cx;
        const dz = p.z - cz;
        return dx * dx + dz * dz < 4.5 * 4.5;
      });
      if (tooCloseToOther) {
        return {
          valid: false,
          position: { x: cx, y: fallbackY, z: cz },
          zoneType,
          groundMeshName: 'OverlapRejected',
          slopeNormalY: 0,
          obstacleClearanceOk: false,
          nearestPropDistance: null,
          reachableFromPath: false,
          adjusted: false,
          reason: 'Terlalu dekat dengan peti lain (< 4.5m)',
        };
      }

      const isBridgeArea = cz >= 629;
      _chestRayOrigin.set(cx, 30, cz);
      _chestRaycaster.set(_chestRayOrigin, _downVec);
      _chestRaycaster.far = isBridgeArea ? 34 : 45;

      let groundHit: THREE.Intersection | undefined;
      if (isBridgeArea && this.bridgeColliderGroup.children.length > 0) {
        const bHits = _chestRaycaster.intersectObjects(this.bridgeColliderGroup.children, true);
        if (bHits.length > 0 && bHits[0].point.y >= -1.5) {
          groundHit = bHits[0];
        }
      }

      if (!groundHit && this.walkableMeshes.length > 0) {
        const wHits = _chestRaycaster.intersectObjects(this.walkableMeshes, true);
        groundHit = wHits.find((h) => {
          if (h.point.y >= 18) return false;
          if (isBridgeArea && h.point.y < -2.0) return false;
          return h.point.y >= -2.5;
        });
      }

      if (!groundHit) {
        return {
          valid: false,
          position: { x: cx, y: fallbackY, z: cz },
          zoneType,
          groundMeshName: 'NoGroundHit',
          slopeNormalY: 0,
          obstacleClearanceOk: false,
          nearestPropDistance: null,
          reachableFromPath: false,
          adjusted: false,
          reason: 'Tidak ditemukan permukaan tanah valid (void/jurang)',
        };
      }

      const groundY = Number(groundHit.point.y.toFixed(3));
      const meshName = groundHit.object.name || 'walkable';

      let slopeNormalY = 1.0;
      if (groundHit.face) {
        _normalMat.getNormalMatrix(groundHit.object.matrixWorld);
        _worldNorm.copy(groundHit.face.normal).applyMatrix3(_normalMat).normalize();
        slopeNormalY = Number(_worldNorm.y.toFixed(2));
      }

      if (slopeNormalY < 0.65) {
        return {
          valid: false,
          position: { x: cx, y: groundY, z: cz },
          zoneType,
          groundMeshName: meshName,
          slopeNormalY,
          obstacleClearanceOk: false,
          nearestPropDistance: null,
          reachableFromPath: false,
          adjusted: false,
          reason: `Kemiringan permukaan terlalu curam (ny=${slopeNormalY})`,
        };
      }

      const { obstacleClearanceOk, nearestPropDistance } = this.querySpatialChestClearance(
        cx,
        groundY,
        cz
      );

      if (!obstacleClearanceOk) {
        return {
          valid: false,
          position: { x: cx, y: groundY, z: cz },
          zoneType,
          groundMeshName: meshName,
          slopeNormalY,
          obstacleClearanceOk: false,
          nearestPropDistance,
          reachableFromPath: false,
          adjusted: false,
          reason: 'Tertutup obstacle pohon/batu/semak (radius < 1.15m)',
        };
      }

      let reachableFromPath = true;
      const roadRefX = cz >= 705 ? -44 : 0;
      const steps = Math.max(2, Math.ceil(Math.abs(cx - roadRefX) / 1.8));
      let prevSampleY = groundY;

      for (let s = 1; s <= steps; s++) {
        const sx = cx + (roadRefX - cx) * (s / steps);
        _chestRayOrigin.set(sx, 25, cz);
        _chestRaycaster.set(_chestRayOrigin, _downVec);
        _chestRaycaster.far = isBridgeArea ? 29 : 35;

        let stepHit: THREE.Intersection | undefined;
        if (isBridgeArea && this.bridgeColliderGroup.children.length > 0) {
          stepHit = _chestRaycaster.intersectObjects(this.bridgeColliderGroup.children, true)[0];
        }
        if (!stepHit && this.walkableMeshes.length > 0) {
          stepHit = _chestRaycaster.intersectObjects(this.walkableMeshes, true).find(
            (h) => h.point.y < 18 && (!isBridgeArea || h.point.y >= -2.0)
          );
        }

        if (!stepHit || Math.abs(stepHit.point.y - prevSampleY) > 1.15) {
          reachableFromPath = false;
          break;
        }
        prevSampleY = stepHit.point.y;
      }

      if (!reachableFromPath) {
        return {
          valid: false,
          position: { x: cx, y: groundY, z: cz },
          zoneType,
          groundMeshName: meshName,
          slopeNormalY,
          obstacleClearanceOk: true,
          nearestPropDistance,
          reachableFromPath: false,
          adjusted: false,
          reason: 'Terhalang jurang/tebing curam dari jalur utama',
        };
      }

      return {
        valid: true,
        position: { x: Number(cx.toFixed(2)), y: groundY, z: Number(cz.toFixed(2)) },
        zoneType,
        groundMeshName: meshName,
        slopeNormalY,
        obstacleClearanceOk: true,
        nearestPropDistance,
        reachableFromPath: true,
        adjusted: false,
        reason: 'OK (Permukaan rata, bebas halangan, mudah dijangkau)',
      };
    };

    const primary = evaluateCandidate(targetX, targetZ);
    if (primary.valid) return primary;

    const fallbackRadii = [1.8, 3.2, 4.8];
    for (const r of fallbackRadii) {
      for (let a = 0; a < 8; a++) {
        const ang = (a * Math.PI) / 4;
        const fx = targetX + Math.cos(ang) * r;
        const fz = targetZ + Math.sin(ang) * r;
        const res = evaluateCandidate(fx, fz);
        if (res.valid) {
          return {
            ...res,
            adjusted: true,
            reason: `Adjusted +${r}m (${primary.reason})`,
          };
        }
      }
    }

    const safeRoadX = targetZ >= 705 ? -58 : targetX >= 0 ? 3.2 : -3.2;
    const roadFallback = evaluateCandidate(safeRoadX, targetZ);
    if (roadFallback.valid) {
      return {
        ...roadFallback,
        adjusted: true,
        reason: `Fallback bahu jalur (${primary.reason})`,
      };
    }

    return {
      ...primary,
      position: { x: targetX, y: primary.position.y, z: targetZ },
    };
  }

  /**
   * Validates & sanitizes a restored player coordinate against map bounds, walkable surfaces,
   * solid obstacles, and chest colliders so refresh recovery never places the player in water/void/stuck.
   */
  public resolveSafePosition(
    candidate: { x: number; y?: number; z: number } | null | undefined,
    chestColliders: ChestCollisionVolume[] = []
  ): { x: number; y: number; z: number; adjusted: boolean; reason: string } {
    const fallbackToSpawn = (reason: string) => {
      const sx = this.config.spawnPosition.x;
      const sz = this.config.spawnPosition.z;
      const g = this.queryGroundSurface(sx, sz, this.config.spawnPosition.y);
      return {
        x: sx,
        y: g.walkable ? g.y : this.config.spawnPosition.y,
        z: sz,
        adjusted: true,
        reason,
      };
    };

    if (
      !candidate ||
      !Number.isFinite(candidate.x) ||
      !Number.isFinite(candidate.z) ||
      (candidate.y !== undefined && !Number.isFinite(candidate.y))
    ) {
      return fallbackToSpawn('Koordinat tersimpan tidak valid, dikembalikan ke spawn aman');
    }

    const clampedX = Math.max(-132, Math.min(132, candidate.x));
    const clampedZ = Math.max(2.0, Math.min(776.0, candidate.z));
    const refY = candidate.y !== undefined ? candidate.y : 2.0;

    const tryPoint = (px: number, pz: number, baseRefY: number) => {
      const ground = this.queryGroundSurface(px, pz, baseRefY);
      if (!ground.walkable) return null;
      const pushed = this.pushOutSolidObstacles(px, pz, ground.y, chestColliders);
      const footCheck = this.isSafeFootprint(pushed.x, pushed.z, ground.y);
      if (!footCheck.ok) return null;
      // Ensure pushed result isn't overlapping any chest collider
      for (let i = 0; i < chestColliders.length; i++) {
        const c = chestColliders[i];
        const minSep = this.config.playerColliderRadius + c.radius;
        const dx = pushed.x - c.x;
        const dz = pushed.z - c.z;
        if (Math.abs(c.y - footCheck.center.y) <= 1.35 && dx * dx + dz * dz < minSep * minSep * 0.95) {
          return null;
        }
      }
      return {
        x: pushed.x,
        y: footCheck.center.y,
        z: pushed.z,
        pushed: pushed.collided,
      };
    };

    const direct = tryPoint(clampedX, clampedZ, refY);
    if (direct) {
      const moved = direct.pushed || Math.abs(clampedX - candidate.x) > 0.01 || Math.abs(clampedZ - candidate.z) > 0.01;
      return {
        x: direct.x,
        y: direct.y,
        z: direct.z,
        adjusted: moved,
        reason: moved ? 'Posisi disesuaikan ke permukaan aman terdekat' : 'Posisi tersimpan tervalidasi aman',
      };
    }

    // Search nearby safe walkable rings around saved coordinate before falling back to spawn
    for (const r of [0.9, 1.8, 3.0, 4.5, 6.0]) {
      for (let a = 0; a < 10; a++) {
        const ang = (a / 10) * Math.PI * 2;
        const res = tryPoint(clampedX + Math.cos(ang) * r, clampedZ + Math.sin(ang) * r, refY);
        if (res) {
          return {
            x: res.x,
            y: res.y,
            z: res.z,
            adjusted: true,
            reason: `Posisi digeser +${r}m ke daratan aman`,
          };
        }
      }
    }

    return fallbackToSpawn('Posisi tersimpan di area terlarang (air/jurang), dikembalikan ke spawn aman');
  }

  /**
   * Toggle developer 3D debug wireframe visibility (false in normal gameplay).
   */
  public setDebugMode(enabled: boolean) {
    this.debugVisualGroup.visible = enabled;
  }

  /**
   * Disposes generated collider and debug geometries/materials (without disposing shared GLTF cache).
   */
  public dispose() {
    this.bridgeColliderGroup.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = obj as THREE.Mesh;
        m.geometry?.dispose();
        if (Array.isArray(m.material)) {
          m.material.forEach((mat) => mat.dispose());
        } else {
          m.material?.dispose();
        }
      }
    });
    this.bridgeColliderGroup.clear();

    this.debugVisualGroup.traverse((obj) => {
      const anyObj = obj as THREE.Mesh | THREE.Line | THREE.LineSegments;
      if ('geometry' in anyObj && anyObj.geometry) {
        anyObj.geometry.dispose();
      }
      if ('material' in anyObj && anyObj.material) {
        if (Array.isArray(anyObj.material)) {
          anyObj.material.forEach((mat) => mat.dispose());
        } else {
          anyObj.material.dispose();
        }
      }
    });
    this.debugObstacleWireframes.clear();
  }
}
