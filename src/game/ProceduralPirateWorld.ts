/**
 * Procedural 3D Pirate Island Environment & Map Loader
 * Created by Deni Raja99 - Pirate Academy
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CollisionSystem } from './CollisionSystem';

export interface WorldDiagnostics {
  mapType: 'procedural' | 'glb';
  mapFilename?: string;
  loadMessage: string;
  objectsCount: number;
}

export class ProceduralPirateWorld {
  public group: THREE.Group;
  public collisionSystem: CollisionSystem;
  public diagnostics: WorldDiagnostics;

  private oceanMesh: THREE.Mesh | null = null;
  private oceanGeometry: THREE.PlaneGeometry | null = null;
  private torchLights: THREE.PointLight[] = [];
  private shipGroup: THREE.Group | null = null;
  private glbScene: THREE.Object3D | null = null;

  constructor(collisionSystem: CollisionSystem) {
    this.group = new THREE.Group();
    this.collisionSystem = collisionSystem;
    this.diagnostics = {
      mapType: 'procedural',
      loadMessage: 'Lingkungan 3D Pulau Bajak Laut Tropis aktif.',
      objectsCount: 0,
    };

    // Build the default procedural world
    this.buildWorld();
  }

  /**
   * Try loading the user's GLB map (game_pirate_adventure_map.glb)
   */
  public tryLoadGlbMap(
    mapUrl: string = '/game_pirate_adventure_map.glb',
    onComplete?: (success: boolean) => void
  ) {
    const loader = new GLTFLoader();
    loader.load(
      mapUrl,
      (gltf) => {
        // If loaded, hide procedural terrain and add GLB map
        this.glbScene = gltf.scene;
        this.glbScene.traverse((node) => {
          if ((node as THREE.Mesh).isMesh) {
            node.castShadow = true;
            node.receiveShadow = true;
          }
        });

        // Compute bounding box to normalize or center
        const bbox = new THREE.Box3().setFromObject(this.glbScene);
        const center = new THREE.Vector3();
        bbox.getCenter(center);
        this.glbScene.position.sub(center);
        this.glbScene.position.y = 0;

        // Hide procedural ground only, keep ocean and lighting
        this.group.children.forEach((child) => {
          if (child.name === 'procedural_island') {
            child.visible = false;
          }
        });

        this.group.add(this.glbScene);
        this.diagnostics = {
          mapType: 'glb',
          mapFilename: mapUrl.split('/').pop(),
          loadMessage: 'Aset GLB peta berhasil dimuat dan aktif!',
          objectsCount: this.glbScene.children.length,
        };
        if (onComplete) onComplete(true);
      },
      undefined,
      (err) => {
        console.info('Aset GLB peta eksternal belum diunggah; menggunakan Pulau Bajak Laut Procedural.', err);
        this.diagnostics = {
          mapType: 'procedural',
          loadMessage: 'Peta procedural Pulau Bajak Laut aktif (Siap menerima game_pirate_adventure_map.glb).',
          objectsCount: this.group.children.length,
        };
        if (onComplete) onComplete(false);
      }
    );
  }

  private buildWorld() {
    const islandRoot = new THREE.Group();
    islandRoot.name = 'procedural_island';

    // 1. Tropical Sandy Island Terrain
    const terrainGeo = new THREE.CylinderGeometry(28, 30, 2.8, 48, 16);
    const posAttr = terrainGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vy = posAttr.getY(i);
      const vz = posAttr.getZ(i);
      if (vy > 0) {
        // Deform upper island surface to create natural dunes & cliffs
        const dist = Math.sqrt(vx * vx + vz * vz);
        let height = this.collisionSystem.getGroundHeight(vx, vz);
        // Add subtle noise
        height += Math.sin(vx * 0.4) * Math.cos(vz * 0.4) * 0.15;
        posAttr.setY(i, height);
      }
    }
    terrainGeo.computeVertexNormals();

    const sandMat = new THREE.MeshStandardMaterial({
      color: 0xeab308, // Golden tropical sand
      roughness: 0.9,
      metalness: 0.05,
      flatShading: true,
    });
    const terrainMesh = new THREE.Mesh(terrainGeo, sandMat);
    terrainMesh.position.y = -0.8;
    terrainMesh.receiveShadow = true;
    islandRoot.add(terrainMesh);

    // 2. Animated Ocean Surface
    this.oceanGeometry = new THREE.PlaneGeometry(240, 240, 64, 64);
    const oceanMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7, // Vibrant tropical ocean turquoise
      roughness: 0.2,
      metalness: 0.1,
      transparent: true,
      opacity: 0.88,
    });
    this.oceanMesh = new THREE.Mesh(this.oceanGeometry, oceanMat);
    this.oceanMesh.rotation.x = -Math.PI / 2;
    this.oceanMesh.position.y = 0.2;
    this.oceanMesh.receiveShadow = true;
    this.group.add(this.oceanMesh);

    // 3. Central Skull Rock formation
    const skullRock = this.createSkullRock();
    skullRock.position.set(0, 1.2, -16);
    islandRoot.add(skullRock);

    // 4. Pirate Ship anchored at bay
    this.shipGroup = this.createPirateShip();
    this.shipGroup.position.set(22, 0.4, 16);
    this.shipGroup.rotation.y = -Math.PI / 3;
    islandRoot.add(this.shipGroup);

    // 5. Wooden Pier / Harbor Jetty
    const pier = this.createWoodenPier();
    islandRoot.add(pier);

    // 6. Ancient Stone Ruins
    const ruins = this.createAncientRuins();
    ruins.position.set(-14, 0.8, -8);
    islandRoot.add(ruins);

    // 7. Palm Trees clustered across island
    const palmPositions: [number, number, number, number][] = [
      [-6, 0.7, 8, 1.1],
      [-10, 0.8, 4, 0.9],
      [-4, 0.9, -6, 1.2],
      [6, 0.8, -10, 1.15],
      [10, 0.9, -4, 0.85],
      [-16, 0.6, -14, 1.0],
      [14, 0.7, 4, 1.2],
      [-12, 0.5, 12, 1.05],
      [4, 1.0, 10, 0.95],
      [-2, 1.8, -12, 1.3],
    ];

    palmPositions.forEach(([px, py, pz, pScale]) => {
      const palm = this.createPalmTree();
      palm.position.set(px, py, pz);
      palm.scale.set(pScale, pScale, pScale);
      islandRoot.add(palm);
    });

    // 8. Torches on wooden posts along paths
    const torchPositions = [
      [-4, 0.8, 4],
      [8, 1.1, 7],
      [-10, 1.2, -6],
      [4, 1.2, -7],
      [0, 2.0, -12],
    ];
    torchPositions.forEach(([tx, ty, tz]) => {
      const torch = this.createTorch(tx, ty, tz);
      islandRoot.add(torch);
    });

    // 9. Rocky cliffs and boulders
    const rockPositions = [
      [-18, 0.4, 2, 2.4],
      [-20, 0.5, -4, 3.2],
      [18, 0.4, -12, 2.8],
      [14, 0.3, 14, 2.0],
      [-8, 0.4, -18, 2.5],
    ];
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.9,
      metalness: 0.05,
      flatShading: true,
    });
    rockPositions.forEach(([rx, ry, rz, rScale]) => {
      const rockGeo = new THREE.DodecahedronGeometry(rScale, 1);
      const rock = new THREE.Mesh(rockGeo, rockMat);
      rock.position.set(rx, ry, rz);
      rock.castShadow = true;
      rock.receiveShadow = true;
      islandRoot.add(rock);
    });

    this.group.add(islandRoot);
  }

  private createSkullRock(): THREE.Group {
    const group = new THREE.Group();
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x334155, // Dark slate rock
      roughness: 0.9,
      metalness: 0.05,
      flatShading: true,
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 1.0,
    });

    // Main crag head
    const cragGeo = new THREE.DodecahedronGeometry(4, 1);
    const crag = new THREE.Mesh(cragGeo, rockMat);
    crag.scale.set(1.1, 1.3, 1.0);
    crag.castShadow = true;
    crag.receiveShadow = true;
    group.add(crag);

    // Carved hollow eye sockets
    for (const eyeX of [-1.1, 1.1]) {
      const eyeGeo = new THREE.CylinderGeometry(0.65, 0.5, 1.2, 8);
      const eye = new THREE.Mesh(eyeGeo, darkMat);
      eye.rotation.x = Math.PI / 2;
      eye.position.set(eyeX, 1.2, 2.6);
      group.add(eye);
    }

    // Nose cavity
    const noseGeo = new THREE.ConeGeometry(0.45, 1.0, 5);
    const nose = new THREE.Mesh(noseGeo, darkMat);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0.3, 2.8);
    group.add(nose);

    // Teeth ridge
    const teethGeo = new THREE.BoxGeometry(2.4, 0.4, 0.6);
    const teeth = new THREE.Mesh(teethGeo, darkMat);
    teeth.position.set(0, -0.6, 2.6);
    group.add(teeth);

    return group;
  }

  private createPirateShip(): THREE.Group {
    const ship = new THREE.Group();
    const hullMat = new THREE.MeshStandardMaterial({
      color: 0x451a03, // Rich dark mahogany wood
      roughness: 0.8,
    });
    const deckMat = new THREE.MeshStandardMaterial({
      color: 0x78350f,
      roughness: 0.7,
    });
    const sailMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc, // Billowing canvas sail
      roughness: 0.9,
      side: THREE.DoubleSide,
    });
    const flagMat = new THREE.MeshBasicMaterial({
      color: 0x09090b, // Jolly Roger black flag
      side: THREE.DoubleSide,
    });

    // Hull (curved boat shape using cylinder halved)
    const hullGeo = new THREE.CylinderGeometry(2.5, 1.4, 12, 8, 1, false, 0, Math.PI);
    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.rotation.x = Math.PI / 2;
    hull.rotation.z = Math.PI;
    hull.scale.set(1, 1.8, 0.9);
    hull.castShadow = true;
    ship.add(hull);

    // Flat Deck
    const deckGeo = new THREE.BoxGeometry(3.6, 0.4, 11);
    const deck = new THREE.Mesh(deckGeo, deckMat);
    deck.position.y = 0.8;
    ship.add(deck);

    // Masts (Main and Fore mast)
    for (const mastZ of [-2.5, 2]) {
      const mastGeo = new THREE.CylinderGeometry(0.16, 0.22, 9, 8);
      const mast = new THREE.Mesh(mastGeo, deckMat);
      mast.position.set(0, 5, mastZ);
      mast.castShadow = true;
      ship.add(mast);

      // Yardarms & Sails
      for (const yLevel of [4, 6.8]) {
        const yardGeo = new THREE.CylinderGeometry(0.08, 0.08, 4.2, 6);
        const yard = new THREE.Mesh(yardGeo, deckMat);
        yard.rotation.z = Math.PI / 2;
        yard.position.set(0, yLevel, mastZ);
        ship.add(yard);

        // Billowing curved sail
        const sailGeo = new THREE.PlaneGeometry(3.8, 2.2, 6, 6);
        const sailMesh = new THREE.Mesh(sailGeo, sailMat);
        sailMesh.position.set(0, yLevel - 1.1, mastZ + 0.3);
        sailMesh.castShadow = true;
        ship.add(sailMesh);
      }
    }

    // Pirate Flag on Main Mast
    const flagGeo = new THREE.PlaneGeometry(1.6, 1.0);
    const flagMesh = new THREE.Mesh(flagGeo, flagMat);
    flagMesh.position.set(0.9, 9.2, -2.5);
    ship.add(flagMesh);

    return ship;
  }

  private createWoodenPier(): THREE.Group {
    const pier = new THREE.Group();
    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x713f12,
      roughness: 0.85,
    });

    // Main walkway
    const walkGeo = new THREE.BoxGeometry(3.5, 0.3, 10);
    const walk = new THREE.Mesh(walkGeo, woodMat);
    walk.position.set(12, 1.1, 9);
    walk.castShadow = true;
    walk.receiveShadow = true;
    pier.add(walk);

    // Supporting pilings in water
    for (let pz = 5; pz <= 13; pz += 2.5) {
      for (const px of [10.5, 13.5]) {
        const postGeo = new THREE.CylinderGeometry(0.18, 0.18, 2.5, 6);
        const post = new THREE.Mesh(postGeo, woodMat);
        post.position.set(px, 0.2, pz);
        post.castShadow = true;
        pier.add(post);
      }
    }

    return pier;
  }

  private createAncientRuins(): THREE.Group {
    const ruins = new THREE.Group();
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0x64748b, // Ancient weathered limestone
      roughness: 0.9,
      flatShading: true,
    });

    // 4 Columns
    const colCoords = [
      [-1.8, -1.8],
      [1.8, -1.8],
      [-1.8, 1.8],
      [1.8, 1.8],
    ];
    colCoords.forEach(([cx, cz]) => {
      const colGeo = new THREE.CylinderGeometry(0.35, 0.42, 3.2, 8);
      const col = new THREE.Mesh(colGeo, stoneMat);
      col.position.set(cx, 1.6, cz);
      col.castShadow = true;
      ruins.add(col);
    });

    // Stone Archway beam across front columns
    const beamGeo = new THREE.BoxGeometry(4.2, 0.5, 0.9);
    const beam = new THREE.Mesh(beamGeo, stoneMat);
    beam.position.set(0, 3.3, -1.8);
    beam.castShadow = true;
    ruins.add(beam);

    return ruins;
  }

  private createPalmTree(): THREE.Group {
    const palm = new THREE.Group();
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x78350f, // Brown bark
      roughness: 0.85,
    });
    const leafMat = new THREE.MeshStandardMaterial({
      color: 0x15803d, // Lush tropical green
      roughness: 0.6,
      side: THREE.DoubleSide,
    });
    const coconutMat = new THREE.MeshStandardMaterial({
      color: 0x451a03,
      roughness: 0.7,
    });

    // Curved Trunk composed of stacked segments
    const segments = 6;
    let currY = 0;
    let currX = 0;
    for (let s = 0; s < segments; s++) {
      const segGeo = new THREE.CylinderGeometry(0.24 - s * 0.02, 0.28 - s * 0.02, 0.8, 6);
      const seg = new THREE.Mesh(segGeo, trunkMat);
      seg.position.set(currX, currY + 0.4, 0);
      seg.rotation.z = -0.08 * (s + 1);
      seg.castShadow = true;
      palm.add(seg);

      currY += 0.75;
      currX += 0.12;
    }

    // Coconuts cluster at top
    for (let c = 0; c < 3; c++) {
      const cocoGeo = new THREE.SphereGeometry(0.18, 6, 6);
      const coco = new THREE.Mesh(cocoGeo, coconutMat);
      const angle = (c * Math.PI * 2) / 3;
      coco.position.set(currX + Math.cos(angle) * 0.25, currY + 0.1, Math.sin(angle) * 0.25);
      palm.add(coco);
    }

    // Radiating Palm Fronds
    const numFronds = 7;
    for (let f = 0; f < numFronds; f++) {
      const frondGeo = new THREE.ConeGeometry(0.7, 3.2, 4);
      const frond = new THREE.Mesh(frondGeo, leafMat);
      frond.scale.set(1.4, 1, 0.1);
      const angle = (f * Math.PI * 2) / numFronds;

      frond.position.set(currX, currY + 0.3, 0);
      frond.rotation.y = angle;
      frond.rotation.x = 1.1; // Arch downwards
      frond.castShadow = true;
      palm.add(frond);
    }

    return palm;
  }

  private createTorch(x: number, y: number, z: number): THREE.Group {
    const torch = new THREE.Group();
    torch.position.set(x, y, z);

    const postMat = new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.8 });
    const postGeo = new THREE.CylinderGeometry(0.08, 0.1, 1.8, 6);
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.y = 0.9;
    post.castShadow = true;
    torch.add(post);

    // Metal braizer cup
    const cupGeo = new THREE.ConeGeometry(0.22, 0.35, 6);
    const cupMat = new THREE.MeshStandardMaterial({ color: 0x27272a, roughness: 0.5 });
    const cup = new THREE.Mesh(cupGeo, cupMat);
    cup.position.y = 1.85;
    cup.rotation.x = Math.PI;
    torch.add(cup);

    // Warm Flame Light
    const flameLight = new THREE.PointLight(0xf97316, 1.8, 8);
    flameLight.position.set(0, 2.05, 0);
    this.torchLights.push(flameLight);
    torch.add(flameLight);

    // Glowing flame core
    const flameGeo = new THREE.SphereGeometry(0.12, 6, 6);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(0, 2.05, 0);
    torch.add(flame);

    return torch;
  }

  public update(delta: number) {
    const time = performance.now() * 0.002;

    // 1. Ocean gentle wave motion
    if (this.oceanGeometry) {
      const pos = this.oceanGeometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i);
        const v = pos.getY(i);
        const zWave = Math.sin(u * 0.15 + time) * 0.22 + Math.cos(v * 0.15 + time * 1.2) * 0.18;
        pos.setZ(i, zWave);
      }
      this.oceanGeometry.computeVertexNormals();
      pos.needsUpdate = true;
    }

    // 2. Torch lights flickering
    this.torchLights.forEach((light, idx) => {
      light.intensity = 1.6 + Math.sin(time * 8 + idx * 2.5) * 0.3 + (Math.random() - 0.5) * 0.15;
    });

    // 3. Pirate ship gentle bobbing in the water
    if (this.shipGroup) {
      this.shipGroup.position.y = 0.4 + Math.sin(time * 0.8) * 0.15;
      this.shipGroup.rotation.z = Math.sin(time * 0.7) * 0.03;
    }
  }
}
