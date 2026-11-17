/**
 * 3D Pirate Adventurer Character
 * Built with modular composite procedural parts and animation cycles
 * Also supports loading custom GLB character when provided
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class PirateCharacter {
  public group: THREE.Group;
  public position: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
  public velocityY: number = 0;
  public isGrounded: boolean = true;
  public rotationY: number = 0;
  public isMoving: boolean = false;

  // Animation nodes for procedural rig
  private leftLeg: THREE.Group | null = null;
  private rightLeg: THREE.Group | null = null;
  private leftArm: THREE.Group | null = null;
  private rightArm: THREE.Group | null = null;
  private bodyMesh: THREE.Group | null = null;
  private hatFeather: THREE.Mesh | null = null;

  // External GLB model state
  private customModel: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private walkAction: THREE.AnimationAction | null = null;
  private idleAction: THREE.AnimationAction | null = null;

  private walkCycleTime: number = 0;

  constructor() {
    this.group = new THREE.Group();
    this.buildProceduralPirate();
  }

  /**
   * Build an authentic, charming 3D Pirate Adventurer using composite geometries
   */
  private buildProceduralPirate() {
    // Clear any existing children
    while (this.group.children.length > 0) {
      this.group.remove(this.group.children[0]);
    }

    const pirateRoot = new THREE.Group();
    pirateRoot.position.y = 0;

    // Materials
    const coatMaterial = new THREE.MeshStandardMaterial({
      color: 0x991b1b, // Pirate Crimson red coat
      roughness: 0.6,
      metalness: 0.1,
    });
    const vestMaterial = new THREE.MeshStandardMaterial({
      color: 0x1e293b, // Dark charcoal vest
      roughness: 0.7,
      metalness: 0.1,
    });
    const goldTrimMaterial = new THREE.MeshStandardMaterial({
      color: 0xf59e0b, // Golden buttons & buckles
      roughness: 0.3,
      metalness: 0.8,
    });
    const pantsMaterial = new THREE.MeshStandardMaterial({
      color: 0x334155, // Slate blue trousers
      roughness: 0.7,
    });
    const bootMaterial = new THREE.MeshStandardMaterial({
      color: 0x3d2011, // Dark brown leather
      roughness: 0.8,
    });
    const skinMaterial = new THREE.MeshStandardMaterial({
      color: 0xffd1b3, // Warm skin tone
      roughness: 0.5,
    });
    const hatMaterial = new THREE.MeshStandardMaterial({
      color: 0x18181b, // Black tricorn hat
      roughness: 0.7,
    });
    const featherMaterial = new THREE.MeshStandardMaterial({
      color: 0xe11d48, // Vibrant crimson feather
      roughness: 0.4,
    });
    const hairMaterial = new THREE.MeshStandardMaterial({
      color: 0x271a0c, // Dark brown curly hair
      roughness: 0.8,
    });

    // 1. Torso & Coat
    const torsoGroup = new THREE.Group();
    torsoGroup.position.y = 0.95;

    // Main chest/coat
    const coatGeo = new THREE.CylinderGeometry(0.32, 0.28, 0.65, 8);
    const coatMesh = new THREE.Mesh(coatGeo, coatMaterial);
    coatMesh.castShadow = true;
    torsoGroup.add(coatMesh);

    // Inner vest / shirt
    const vestGeo = new THREE.BoxGeometry(0.24, 0.45, 0.28);
    const vestMesh = new THREE.Mesh(vestGeo, vestMaterial);
    vestMesh.position.z = 0.08;
    torsoGroup.add(vestMesh);

    // Gold buttons
    for (let i = -1; i <= 1; i++) {
      const btnGeo = new THREE.SphereGeometry(0.03, 6, 6);
      const btnMesh = new THREE.Mesh(btnGeo, goldTrimMaterial);
      btnMesh.position.set(0, i * 0.12, 0.23);
      torsoGroup.add(btnMesh);
    }

    // Pirate Belt & Gold Buckle
    const beltGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.1, 8);
    const beltMesh = new THREE.Mesh(beltGeo, bootMaterial);
    beltMesh.position.y = -0.22;
    torsoGroup.add(beltMesh);

    const buckleGeo = new THREE.BoxGeometry(0.12, 0.1, 0.06);
    const buckleMesh = new THREE.Mesh(buckleGeo, goldTrimMaterial);
    buckleMesh.position.set(0, -0.22, 0.32);
    torsoGroup.add(buckleMesh);

    this.bodyMesh = torsoGroup;
    pirateRoot.add(torsoGroup);

    // 2. Head & Pirate Face
    const headGroup = new THREE.Group();
    headGroup.position.y = 1.48;

    const headGeo = new THREE.SphereGeometry(0.24, 12, 10);
    const headMesh = new THREE.Mesh(headGeo, skinMaterial);
    headMesh.castShadow = true;
    headGroup.add(headMesh);

    // Hair
    const hairGeo = new THREE.SphereGeometry(0.26, 10, 8);
    const hairMesh = new THREE.Mesh(hairGeo, hairMaterial);
    hairMesh.position.set(0, 0.04, -0.04);
    hairMesh.scale.set(1.02, 0.95, 1.05);
    headGroup.add(hairMesh);

    // Pirate Eye Patch on left eye
    const patchGeo = new THREE.SphereGeometry(0.07, 8, 8);
    const patchMesh = new THREE.Mesh(patchGeo, hatMaterial);
    patchMesh.position.set(-0.1, 0.04, 0.21);
    patchMesh.scale.set(1, 0.8, 0.3);
    headGroup.add(patchMesh);

    // Eye patch strap
    const strapGeo = new THREE.TorusGeometry(0.23, 0.015, 6, 16);
    const strapMesh = new THREE.Mesh(strapGeo, hatMaterial);
    strapMesh.rotation.x = Math.PI / 2;
    strapMesh.rotation.y = 0.25;
    strapMesh.position.set(0, 0.04, 0);
    headGroup.add(strapMesh);

    // Right Eye
    const eyeGeo = new THREE.SphereGeometry(0.04, 6, 6);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1e293b });
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.1, 0.04, 0.21);
    headGroup.add(rightEye);

    // 3. Tricorn Pirate Hat
    const hatGroup = new THREE.Group();
    hatGroup.position.y = 0.22;

    const hatBrimGeo = new THREE.CylinderGeometry(0.48, 0.44, 0.06, 3);
    const hatBrim = new THREE.Mesh(hatBrimGeo, hatMaterial);
    hatBrim.rotation.y = Math.PI / 6;
    hatBrim.castShadow = true;
    hatGroup.add(hatBrim);

    const hatCrownGeo = new THREE.CylinderGeometry(0.24, 0.28, 0.22, 8);
    const hatCrown = new THREE.Mesh(hatCrownGeo, hatMaterial);
    hatCrown.position.y = 0.12;
    hatGroup.add(hatCrown);

    // Gold skull crest on hat
    const crestGeo = new THREE.BoxGeometry(0.08, 0.08, 0.04);
    const crestMesh = new THREE.Mesh(crestGeo, goldTrimMaterial);
    crestMesh.position.set(0, 0.12, 0.26);
    hatGroup.add(crestMesh);

    // Red pirate feather
    const featherGeo = new THREE.ConeGeometry(0.06, 0.35, 6);
    const feather = new THREE.Mesh(featherGeo, featherMaterial);
    feather.position.set(-0.25, 0.25, -0.05);
    feather.rotation.z = 0.6;
    feather.rotation.x = -0.3;
    this.hatFeather = feather;
    hatGroup.add(feather);

    headGroup.add(hatGroup);
    pirateRoot.add(headGroup);

    // 4. Arms (Pivoted at shoulders)
    // Left Arm
    this.leftArm = new THREE.Group();
    this.leftArm.position.set(-0.38, 1.2, 0);
    const lArmMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.42, 6), coatMaterial);
    lArmMesh.position.y = -0.21;
    lArmMesh.castShadow = true;
    this.leftArm.add(lArmMesh);
    const lHand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), skinMaterial);
    lHand.position.y = -0.44;
    this.leftArm.add(lHand);
    pirateRoot.add(this.leftArm);

    // Right Arm
    this.rightArm = new THREE.Group();
    this.rightArm.position.set(0.38, 1.2, 0);
    const rArmMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.42, 6), coatMaterial);
    rArmMesh.position.y = -0.21;
    rArmMesh.castShadow = true;
    this.rightArm.add(rArmMesh);
    const rHand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), skinMaterial);
    rHand.position.y = -0.44;
    this.rightArm.add(rHand);
    pirateRoot.add(this.rightArm);

    // 5. Legs (Pivoted at hips)
    // Left Leg
    this.leftLeg = new THREE.Group();
    this.leftLeg.position.set(-0.16, 0.65, 0);
    const lThigh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.09, 0.35, 6), pantsMaterial);
    lThigh.position.y = -0.17;
    lThigh.castShadow = true;
    this.leftLeg.add(lThigh);
    const lBoot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.35, 0.26), bootMaterial);
    lBoot.position.set(0, -0.45, 0.04);
    lBoot.castShadow = true;
    this.leftLeg.add(lBoot);
    pirateRoot.add(this.leftLeg);

    // Right Leg
    this.rightLeg = new THREE.Group();
    this.rightLeg.position.set(0.16, 0.65, 0);
    const rThigh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.09, 0.35, 6), pantsMaterial);
    rThigh.position.y = -0.17;
    rThigh.castShadow = true;
    this.rightLeg.add(rThigh);
    const rBoot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.35, 0.26), bootMaterial);
    rBoot.position.set(0, -0.45, 0.04);
    rBoot.castShadow = true;
    this.rightLeg.add(rBoot);
    pirateRoot.add(this.rightLeg);

    // Contact Shadow beneath player
    const shadowGeo = new THREE.CircleGeometry(0.55, 16);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.y = 0.02;
    pirateRoot.add(shadowMesh);

    this.group.add(pirateRoot);
  }

  /**
   * Load external GLB character if provided
   */
  public loadGlbModel(url: string, onLoadSuccess?: () => void, onLoadFail?: (err: Error) => void) {
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        // Clear procedural
        while (this.group.children.length > 0) {
          this.group.remove(this.group.children[0]);
        }
        this.customModel = gltf.scene;
        this.customModel.traverse((node) => {
          if ((node as THREE.Mesh).isMesh) {
            node.castShadow = true;
            node.receiveShadow = true;
          }
        });

        // Compute bounding box and normalize scale to ~1.7m height
        const bbox = new THREE.Box3().setFromObject(this.customModel);
        const size = new THREE.Vector3();
        bbox.getSize(size);
        if (size.y > 0) {
          const scale = 1.7 / size.y;
          this.customModel.scale.set(scale, scale, scale);
        }

        this.group.add(this.customModel);

        if (gltf.animations && gltf.animations.length > 0) {
          this.mixer = new THREE.AnimationMixer(this.customModel);
          this.idleAction = this.mixer.clipAction(gltf.animations[0]);
          this.idleAction.play();
          if (gltf.animations.length > 1) {
            this.walkAction = this.mixer.clipAction(gltf.animations[1]);
          }
        }
        if (onLoadSuccess) onLoadSuccess();
      },
      undefined,
      (err) => {
        console.warn('Could not load custom character GLB, keeping procedural model', err);
        if (onLoadFail) onLoadFail(err as Error);
      }
    );
  }

  /**
   * Update character motion, procedural animations, and physics
   */
  public update(delta: number, isMoving: boolean, moveSpeed: number = 5.5) {
    this.isMoving = isMoving;

    // External model mixer update
    if (this.mixer) {
      this.mixer.update(delta);
      if (this.walkAction && this.idleAction) {
        if (isMoving) {
          this.walkAction.play();
          this.idleAction.stop();
        } else {
          this.idleAction.play();
          this.walkAction.stop();
        }
      }
      return;
    }

    // Procedural animation update
    if (isMoving) {
      this.walkCycleTime += delta * moveSpeed * 2.2;
      const legAngle = Math.sin(this.walkCycleTime) * 0.55;
      const armAngle = -Math.sin(this.walkCycleTime) * 0.45;

      if (this.leftLeg) this.leftLeg.rotation.x = legAngle;
      if (this.rightLeg) this.rightLeg.rotation.x = -legAngle;
      if (this.leftArm) this.leftArm.rotation.x = armAngle;
      if (this.rightArm) this.rightArm.rotation.x = -armAngle;

      if (this.bodyMesh) {
        this.bodyMesh.position.y = 0.95 + Math.abs(Math.sin(this.walkCycleTime * 2)) * 0.05;
      }
      if (this.hatFeather) {
        this.hatFeather.rotation.z = 0.6 + Math.sin(this.walkCycleTime * 2) * 0.1;
      }
    } else {
      // Idle gentle breathing
      const idleTime = performance.now() * 0.0025;
      if (this.leftLeg) this.leftLeg.rotation.x = 0;
      if (this.rightLeg) this.rightLeg.rotation.x = 0;
      if (this.leftArm) this.leftArm.rotation.x = Math.sin(idleTime) * 0.08;
      if (this.rightArm) this.rightArm.rotation.x = -Math.sin(idleTime) * 0.08;

      if (this.bodyMesh) {
        this.bodyMesh.position.y = 0.95 + Math.sin(idleTime) * 0.02;
      }
      if (this.hatFeather) {
        this.hatFeather.rotation.z = 0.6 + Math.sin(idleTime) * 0.05;
      }
    }

    // Smooth rotation towards movement direction
    this.group.rotation.y = THREE.MathUtils.damp(this.group.rotation.y, this.rotationY, 12, delta);

    // Apply position
    this.group.position.copy(this.position);
  }
}
