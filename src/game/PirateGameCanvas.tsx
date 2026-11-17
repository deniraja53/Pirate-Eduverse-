/**
 * Main 3D WebGL Canvas for Pirate Academy: Treasure Quest
 * Powered by Three.js with Smooth Third-Person Controller,
 * Real GLB Map (game_pirate_adventure_map.glb), Character (karakter edgar.glb),
 * Dedicated Bridge Colliders, and Distributed Treasure Chests.
 * Clean 3D Viewport without permanent debugging UI clutter.
 * Created by Deni Raja99
 */

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GameConfig } from './GameConfig';
import {
  ChestCollisionVolume,
  FINISH_SHIP_AREA,
  MapEnvironment,
  MapDiagnostics,
  RaycastDebugData,
} from './MapEnvironment';
import { CharacterController, CharacterDiagnostics } from './CharacterController';
import { ThirdPersonCamera } from './ThirdPersonCamera';
import { TreasureChest } from './TreasureChest';
import { getDistributedChestsForQuestions } from './ChestConfig';
import { ChestPlacementMeta, QuestionPackage, StudentSession } from '../types/game';
import {
  DEFAULT_PLAYABLE_WORLD_BOUNDS,
  type MiniMapLiveState,
} from './MiniMapTypes';
import { sounds } from '../services/audio';

// Reusable module-scope math vectors to prevent GC churn inside 60fps tick loop
const _camForward = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _moveVector = new THREE.Vector3();
const _upAxis = new THREE.Vector3(0, 1, 0);

interface PirateGameCanvasProps {
  questionPackage: QuestionPackage;
  session: StudentSession;
  onOpenChest: (questionId: string) => void;
  onFinishQuest?: () => void;
  onSceneReady?: () => void;
  onSceneError?: (message: string) => void;
  isPaused: boolean;
  gameConfig: GameConfig;
  onUpdateDebugData?: (data: RaycastDebugData) => void;
  onUpdateChestPlacements?: (reports: ChestPlacementMeta[]) => void;
  miniMapStateRef?: React.MutableRefObject<MiniMapLiveState | null>;
  virtualJoystickVector?: { x: number; y: number };
  virtualInteractTrigger?: number;
  virtualJumpTrigger?: number;
}

export const PirateGameCanvas: React.FC<PirateGameCanvasProps> = ({
  questionPackage,
  session,
  onOpenChest,
  onFinishQuest,
  onSceneReady,
  onSceneError,
  isPaused,
  gameConfig,
  onUpdateDebugData,
  onUpdateChestPlacements,
  miniMapStateRef,
  virtualJoystickVector,
  virtualInteractTrigger,
  virtualJumpTrigger,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [nearestChest, setNearestChest] = useState<TreasureChest | null>(null);
  const [finishZoneNotice, setFinishZoneNotice] = useState<{
    ready: boolean;
    completed: number;
    total: number;
  } | null>(null);

  // Mutable state across animation loop
  const stateRef = useRef({
    keys: {
      forward: false,
      backward: false,
      left: false,
      right: false,
      jump: false,
    },
    isDraggingMouse: false,
    prevPointerX: 0,
    prevPointerY: 0,
    isPaused: false,
    nearestChest: null as TreasureChest | null,
    chests: [] as TreasureChest[],
    onOpenChest,
    onFinishQuest,
    onSceneReady,
    onSceneError,
    miniMapStateRef,
    completedCount: session.chestsCompleted.length,
    totalCount: questionPackage.questions.length,
    finishTriggered: false,
    finishTriggerY: 0.98,
    wasInFinishZone: false,
    lastFinishNoticeKey: '',
    config: { ...gameConfig },
    cameraController: null as ThirdPersonCamera | null,
    characterController: null as CharacterController | null,
    mapEnvironment: null as MapEnvironment | null,
    virtualJoystickVector: { x: 0, y: 0 },
  });

  const syncMiniMapSnapshot = () => {
    const target = stateRef.current.miniMapStateRef?.current;
    if (!target) return;

    const chests = stateRef.current.chests;
    let minX = DEFAULT_PLAYABLE_WORLD_BOUNDS.minX;
    let maxX = DEFAULT_PLAYABLE_WORLD_BOUNDS.maxX;
    let minZ = DEFAULT_PLAYABLE_WORLD_BOUNDS.minZ;
    let maxZ = DEFAULT_PLAYABLE_WORLD_BOUNDS.maxZ;

    target.chests = chests.map((ch) => {
      const cx = ch.group.position.x;
      const cz = ch.group.position.z;
      if (cx < minX) minX = cx - 10;
      if (cx > maxX) maxX = cx + 10;
      if (cz < minZ) minZ = cz - 10;
      if (cz > maxZ) maxZ = cz + 10;

      return {
        chestId: ch.chestId,
        questionId: ch.questionId,
        questionNumber: ch.question.number,
        x: cx,
        z: cz,
        active: ch.active,
        completed: ch.status === 'completed',
        locked: ch.status === 'locked',
      };
    });

    target.worldBounds = { minX, maxX, minZ, maxZ };
    if (stateRef.current.characterController) {
      target.playerX = stateRef.current.characterController.group.position.x;
      target.playerZ = stateRef.current.characterController.group.position.z;
      target.playerRotationY = stateRef.current.characterController.currentRotationY;
    }
    target.ready = true;
  };

  // Sync stateRef with props
  useEffect(() => {
    stateRef.current.isPaused = isPaused;
    stateRef.current.onOpenChest = onOpenChest;
    stateRef.current.onFinishQuest = onFinishQuest;
    stateRef.current.onSceneReady = onSceneReady;
    stateRef.current.onSceneError = onSceneError;
    stateRef.current.miniMapStateRef = miniMapStateRef;
    stateRef.current.completedCount = session.chestsCompleted.length;
    stateRef.current.totalCount = questionPackage.questions.length;
  }, [
    isPaused,
    onOpenChest,
    onFinishQuest,
    onSceneReady,
    onSceneError,
    miniMapStateRef,
    session.chestsCompleted.length,
    questionPackage.questions.length,
  ]);

  useEffect(() => {
    if (virtualJoystickVector) {
      stateRef.current.virtualJoystickVector = virtualJoystickVector;
    }
  }, [virtualJoystickVector]);

  // Sync gameConfig updates live
  useEffect(() => {
    stateRef.current.config = { ...gameConfig };
    if (stateRef.current.cameraController) {
      stateRef.current.cameraController.config = { ...gameConfig };
    }
    if (stateRef.current.characterController) {
      stateRef.current.characterController.config = { ...gameConfig };
      stateRef.current.characterController.setDebugMode(Boolean(gameConfig.debugMode));
    }
    if (stateRef.current.mapEnvironment) {
      stateRef.current.mapEnvironment.config = { ...gameConfig };
      stateRef.current.mapEnvironment.setDebugMode(Boolean(gameConfig.debugMode));
    }
    stateRef.current.chests.forEach((chest) => {
      chest.setDebugMode(Boolean(gameConfig.debugMode));
    });
  }, [gameConfig]);

  // Sync chest completion status from session
  useEffect(() => {
    stateRef.current.chests.forEach((chest) => {
      const isCompleted = session.chestsCompleted.includes(chest.questionId);
      if (isCompleted) {
        chest.setStatus('completed');
      } else if (questionPackage.isSequential) {
        const currentNum = chest.question.number;
        const allCompletedBefore = questionPackage.questions
          .filter((q) => q.number < currentNum)
          .every((q) => session.chestsCompleted.includes(q.id));
        chest.setStatus(allCompletedBefore ? 'available' : 'locked');
      } else {
        chest.setStatus('available');
      }
    });
    syncMiniMapSnapshot();
  }, [session.chestsCompleted, questionPackage.isSequential, questionPackage.questions]);

  // Handle virtual interact trigger
  useEffect(() => {
    if (virtualInteractTrigger && stateRef.current.nearestChest && !isPaused) {
      if (stateRef.current.nearestChest.status !== 'locked') {
        sounds.playChestOpen();
        stateRef.current.onOpenChest(stateRef.current.nearestChest.questionId);
      }
    }
  }, [virtualInteractTrigger, isPaused]);

  // Handle virtual jump trigger
  useEffect(() => {
    if (virtualJumpTrigger && stateRef.current.characterController && !isPaused) {
      if (stateRef.current.characterController.isGrounded) {
        stateRef.current.characterController.verticalVelocity = stateRef.current.config.jumpForce;
        stateRef.current.characterController.isGrounded = false;
        sounds.playJump();
      }
    }
  }, [virtualJumpTrigger, isPaused]);

  // Main Three.js Scene Setup & Loop
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const config = stateRef.current.config;

    // 1. Detect Software WebGL
    const isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    // 2. Three.js Renderer
    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    // 3. Scene & Atmospheric Lighting
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x38bdf8); // Sky blue
    scene.fog = new THREE.FogExp2(0x38bdf8, 0.0035); // Extended view distance for 750m adventure trail

    // Studio Environment
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // Directional Sunlight
    const sunLight = new THREE.DirectionalLight(0xfff7ed, 2.4);
    sunLight.position.set(40, 80, 50);
    sunLight.castShadow = !isSoftwareGl;
    if (!isSoftwareGl) {
      sunLight.shadow.mapSize.width = 2048;
      sunLight.shadow.mapSize.height = 2048;
      sunLight.shadow.camera.near = 10;
      sunLight.shadow.camera.far = 300;
      sunLight.shadow.camera.left = -60;
      sunLight.shadow.camera.right = 60;
      sunLight.shadow.camera.top = 60;
      sunLight.shadow.camera.bottom = -60;
      sunLight.shadow.bias = -0.0004;
      sunLight.shadow.normalBias = 0.02;
    }
    scene.add(sunLight);

    const hemiLight = new THREE.HemisphereLight(0x7dd3fc, 0x78350f, 0.9);
    scene.add(hemiLight);

    const ambientLight = new THREE.AmbientLight(0xffedd5, 0.5);
    scene.add(ambientLight);

    // 4. Camera & Camera Controller
    const camera = new THREE.PerspectiveCamera(
      55,
      container.clientWidth / container.clientHeight,
      0.1,
      1400
    );
    const cameraController = new ThirdPersonCamera(camera, config);
    stateRef.current.cameraController = cameraController;

    // 5. Load Map Environment with Dedicated Bridge Colliders
    const mapEnv = new MapEnvironment(config);
    scene.add(mapEnv.group);
    stateRef.current.mapEnvironment = mapEnv;
    mapEnv.setDebugMode(Boolean(config.debugMode));

    // 6. Character Controller (karakter edgar.glb)
    const charController = new CharacterController(config, mapEnv);
    charController.setDebugMode(Boolean(config.debugMode));
    scene.add(charController.group);
    stateRef.current.characterController = charController;

    // 7. Visual Landmarks: START Gate, Grounded FINISH Monument & Non-Solid Embarkation Ring
    const startGateGroup = createStartGate();
    scene.add(startGateGroup);

    const finishMonumentGroup = createFinishMonument();
    scene.add(finishMonumentGroup);

    const finishEmbarkRing = createFinishEmbarkRing();
    scene.add(finishEmbarkRing);

    // 8. Distribute Question Chests organically across 4 zones from START to FINISH
    const distributedWaypoints = getDistributedChestsForQuestions(questionPackage.questions.length);
    const chestsList: TreasureChest[] = [];

    questionPackage.questions.forEach((q, idx) => {
      const mapping = questionPackage.chestMappings?.find((m) => m.questionId === q.id);
      const waypoint = distributedWaypoints[idx] || distributedWaypoints[distributedWaypoints.length - 1];
      const pos: [number, number, number] = [
        waypoint.x,
        waypoint.y,
        waypoint.z,
      ];

      const resolvedZoneType = mapping?.zoneType || q.zoneType || waypoint.zoneType;
      const resolvedRadius = mapping?.interactionRadius || waypoint.interactionRadius || 3.4;

      const enhancedQuestion = {
        ...q,
        zoneType: resolvedZoneType,
        locationName: mapping?.locationName || q.locationName || waypoint.name,
      };

      const chest = new TreasureChest(enhancedQuestion, pos, {
        chestId: mapping?.chestId || `chest-${String(idx + 1).padStart(2, '0')}`,
        zoneType: resolvedZoneType,
        interactionRadius: resolvedRadius,
        active: mapping?.active ?? true,
      });
      chest.setDebugMode(Boolean(config.debugMode));

      if (session.chestsCompleted.includes(q.id)) {
        chest.setStatus('completed');
      } else if (questionPackage.isSequential && idx > 0) {
        chest.setStatus('locked');
      } else {
        chest.setStatus('available');
      }

      chestsList.push(chest);
      scene.add(chest.group);
    });
    stateRef.current.chests = chestsList;
    syncMiniMapSnapshot();

    // Load both models asynchronously & run runtime GLB terrain/obstacle chest validation
    let sceneDisposed = false;

    const mapLoadPromise = mapEnv.loadMap().then(() => {
      if (sceneDisposed) return;
      const spawnGround = mapEnv.getGroundHeight(config.spawnPosition.x, config.spawnPosition.z);
      charController.group.position.y = spawnGround.y;
      cameraController.resetToCharacter(charController.group.position);

      const occupiedPositions: Array<{ x: number; z: number }> = [];
      const validationReports: ChestPlacementMeta[] = [];

      stateRef.current.chests.forEach((chest) => {
        const validation = mapEnv.validateChestPlacement(
          chest.position.x,
          chest.position.z,
          chest.position.y,
          chest.zoneType,
          occupiedPositions
        );
        chest.setValidatedPlacement(validation);
        occupiedPositions.push({ x: validation.position.x, z: validation.position.z });
        validationReports.push(validation);
      });

      syncMiniMapSnapshot();

      if (onUpdateChestPlacements) {
        onUpdateChestPlacements(validationReports);
      }

      const finGround = mapEnv.getGroundHeight(
        FINISH_SHIP_AREA.monumentPos.x,
        FINISH_SHIP_AREA.monumentPos.z,
        1.2
      );
      if (finGround.hit) {
        finishMonumentGroup.position.set(
          FINISH_SHIP_AREA.monumentPos.x,
          finGround.y,
          FINISH_SHIP_AREA.monumentPos.z
        );
      }

      const trigGround = mapEnv.getGroundHeight(
        FINISH_SHIP_AREA.triggerCenter.x,
        FINISH_SHIP_AREA.triggerCenter.z,
        1.0
      );
      const trigY = trigGround.hit ? trigGround.y : 0.98;
      stateRef.current.finishTriggerY = trigY;
      finishEmbarkRing.position.set(
        FINISH_SHIP_AREA.triggerCenter.x,
        trigY + 0.05,
        FINISH_SHIP_AREA.triggerCenter.z
      );
    });

    const charLoadPromise = charController.loadCharacter();

    Promise.all([mapLoadPromise, charLoadPromise])
      .then(() => {
        if (!sceneDisposed) {
          stateRef.current.onSceneReady?.();
        }
      })
      .catch((err) => {
        console.error('Error loading 3D scene assets:', err);
        if (!sceneDisposed) {
          stateRef.current.onSceneError?.(
            'Gagal memuat model peta atau karakter 3D. Periksa koneksi lalu coba lagi.'
          );
        }
      });

    // 9. Desktop Controls Event Handlers using KeyboardEvent.code
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea' || stateRef.current.isPaused) {
        return;
      }

      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          stateRef.current.keys.forward = true;
          break;
        case 'KeyS':
        case 'ArrowDown':
          stateRef.current.keys.backward = true;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          stateRef.current.keys.left = true;
          break;
        case 'KeyD':
        case 'ArrowRight':
          stateRef.current.keys.right = true;
          break;
        case 'Space':
          if (charController.isGrounded) {
            charController.verticalVelocity = stateRef.current.config.jumpForce;
            charController.isGrounded = false;
            sounds.playJump();
          }
          break;
        case 'KeyE':
        case 'Enter':
          if (stateRef.current.nearestChest && stateRef.current.nearestChest.status !== 'locked') {
            sounds.playChestOpen();
            stateRef.current.onOpenChest(stateRef.current.nearestChest.questionId);
          }
          break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          stateRef.current.keys.forward = false;
          break;
        case 'KeyS':
        case 'ArrowDown':
          stateRef.current.keys.backward = false;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          stateRef.current.keys.left = false;
          break;
        case 'KeyD':
        case 'ArrowRight':
          stateRef.current.keys.right = false;
          break;
      }
    };

    // Mouse Drag for Camera Orbiting
    const handlePointerDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).tagName !== 'CANVAS') return;
      stateRef.current.isDraggingMouse = true;
      stateRef.current.prevPointerX = e.clientX;
      stateRef.current.prevPointerY = e.clientY;
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!stateRef.current.isDraggingMouse || stateRef.current.isPaused) return;
      const dx = e.clientX - stateRef.current.prevPointerX;
      const dy = e.clientY - stateRef.current.prevPointerY;
      cameraController.rotate(dx, dy);
      stateRef.current.prevPointerX = e.clientX;
      stateRef.current.prevPointerY = e.clientY;
    };

    const handlePointerUp = () => {
      stateRef.current.isDraggingMouse = false;
    };

    const handleResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('resize', handleResize);
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    // 10. Main Game Loop with Delta Time
    const clock = new THREE.Clock();
    let frameId = 0;
    let finishTimerId: number | null = null;
    let stepSoundTimer = 0;
    let diagUpdateTimer = 0;
    stateRef.current.finishTriggered = false;
    stateRef.current.wasInFinishZone = false;
    stateRef.current.lastFinishNoticeKey = '';

    function tick() {
      const delta = Math.min(clock.getDelta(), 0.1);
      const elapsed = clock.elapsedTime;

      if (!stateRef.current.isPaused) {
        // 10a. Direction vector calculation relative to horizontal camera orientation
        const keys = stateRef.current.keys;

        camera.getWorldDirection(_camForward);
        _camForward.y = 0;
        _camForward.normalize();

        _camRight.crossVectors(_camForward, _upAxis).normalize();

        _moveVector.set(0, 0, 0);

        if (keys.forward)  _moveVector.add(_camForward);
        if (keys.backward) _moveVector.sub(_camForward);
        if (keys.right)    _moveVector.add(_camRight);
        if (keys.left)     _moveVector.sub(_camRight);

        const joy = stateRef.current.virtualJoystickVector;
        if (Math.abs(joy.x) > 0.1 || Math.abs(joy.y) > 0.1) {
          _moveVector.addScaledVector(_camRight, joy.x);
          _moveVector.addScaledVector(_camForward, -joy.y);
        }

        let normDir: { x: number; z: number } | null = null;
        if (_moveVector.lengthSq() > 0.0025) {
          _moveVector.normalize();
          normDir = {
            x: _moveVector.x,
            z: _moveVector.z,
          };
        }

        // 10b. Collect active solid chest cylinders & update Character Controller substep collision physics
        const chestColliders: ChestCollisionVolume[] = [];
        for (let i = 0; i < chestsList.length; i++) {
          const ch = chestsList[i];
          if (ch.active) {
            chestColliders.push({
              id: ch.chestId,
              x: ch.group.position.x,
              y: ch.group.position.y,
              z: ch.group.position.z,
              radius: 0.76,
            });
          }
        }

        charController.update(delta, normDir, false, chestColliders);

        if (charController.currentSpeed > 0.5 && charController.isGrounded) {
          stepSoundTimer += delta;
          if (stepSoundTimer > 0.36) {
            stepSoundTimer = 0;
            sounds.playStep();
          }
        }

        // 10c. Update Third-Person Camera with Smooth Exponential Damping
        cameraController.update(
          charController.group.position,
          delta,
          charController.group.position.y - 0.5
        );

        sunLight.position.set(
          charController.group.position.x + 35,
          charController.group.position.y + 70,
          charController.group.position.z + 45
        );
        sunLight.target = charController.group;

        // 10d. Hysteresis Proximity Interaction Detection ([E] prompt aura remains wider than physical collision)
        let closestChest: TreasureChest | null = null;
        let closestDist = 999;
        const playerPos = charController.group.position;
        const currentNearest = stateRef.current.nearestChest;

        chestsList.forEach((chest) => {
          chest.update(delta);
          if (!chest.active) return;

          const dy = Math.abs(playerPos.y - chest.group.position.y);
          const effectiveRadius =
            currentNearest === chest ? chest.interactionRadius + 0.3 : chest.interactionRadius;
          const dist3D = playerPos.distanceTo(chest.group.position);

          if (dist3D <= effectiveRadius && dy <= 2.4 && dist3D < closestDist) {
            closestDist = dist3D;
            closestChest = chest;
          }
        });

        if (stateRef.current.nearestChest !== closestChest) {
          stateRef.current.nearestChest = closestChest;
          setNearestChest(closestChest);
        }

        // 10d-2. Gentle pulse on Finish Embarkation Ring & Non-Solid Finish Trigger Zone detection
        const pulseScale = 1 + Math.sin(elapsed * 2.8) * 0.05;
        finishEmbarkRing.scale.set(pulseScale, 1, pulseScale);

        const distToFinish = Math.hypot(
          playerPos.x - FINISH_SHIP_AREA.triggerCenter.x,
          playerPos.z - FINISH_SHIP_AREA.triggerCenter.z
        );
        const surfCat = mapEnv.latestDebugData.surfaceCategory;
        const isValidFinishFoot = surfCat !== 'water_shore' && surfCat !== 'chasm_void' && surfCat !== 'map_boundary';
        const isInsideFinish =
          distToFinish <= FINISH_SHIP_AREA.triggerRadius &&
          Math.abs(playerPos.y - stateRef.current.finishTriggerY) <= 3.0 &&
          isValidFinishFoot;

        const completed = stateRef.current.completedCount;
        const total = stateRef.current.totalCount;
        const readyToFinish = total > 0 && completed >= total;
        const noticeKey = isInsideFinish ? `${readyToFinish}-${completed}-${total}` : '';

        if (noticeKey !== stateRef.current.lastFinishNoticeKey) {
          stateRef.current.lastFinishNoticeKey = noticeKey;
          setFinishZoneNotice(
            isInsideFinish ? { ready: readyToFinish, completed, total } : null
          );
        }

        if (isInsideFinish && readyToFinish && !stateRef.current.finishTriggered) {
          stateRef.current.finishTriggered = true;
          sounds.playVictory();
          finishTimerId = window.setTimeout(() => {
            stateRef.current.onFinishQuest?.();
          }, 420);
        }
        stateRef.current.wasInFinishZone = isInsideFinish;

        // 10e. Periodic Diagnostics Update ONLY when Developer Debug Mode is enabled
        if (stateRef.current.config.debugMode) {
          diagUpdateTimer += delta;
          if (diagUpdateTimer > 0.25) {
            diagUpdateTimer = 0;
            if (onUpdateDebugData) {
              onUpdateDebugData({ ...mapEnv.latestDebugData });
            }
          }
        }
      }

      // Feed live player coordinates & yaw directly into mutable MiniMap ref (zero React re-renders)
      const mm = stateRef.current.miniMapStateRef?.current;
      if (mm) {
        mm.playerX = charController.group.position.x;
        mm.playerZ = charController.group.position.z;
        mm.playerRotationY = charController.currentRotationY;
        mm.ready = true;
      }

      renderer.render(scene, camera);
      frameId = requestAnimationFrame(tick);
    }

    frameId = requestAnimationFrame(tick);

    // Cleanup on unmount
    return () => {
      sceneDisposed = true;
      cancelAnimationFrame(frameId);
      if (finishTimerId !== null) {
        window.clearTimeout(finishTimerId);
      }
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [
    session.sessionId,
    questionPackage.id,
    questionPackage.questions.map((q) => q.id).join(','),
  ]);

  return (
    <div className="relative w-full h-full select-none overflow-hidden">
      {/* 3D WebGL Canvas Mount */}
      <div
        ref={mountRef}
        className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing"
      />

      {/* 
        Proximity Interaction Prompt (Only shown when player is right in front of a chest < 3.4m)
        Kept clean, centered, and disappears when player walks away.
      */}
      {nearestChest && !isPaused && (
        <div className="absolute top-[156px] sm:top-20 left-1/2 -translate-x-1/2 pointer-events-none z-20 max-w-[92vw]">
          <div className="bg-slate-950/90 border-2 border-amber-500/80 px-5 sm:px-6 py-2.5 rounded-2xl shadow-2xl backdrop-blur-xs text-center flex items-center gap-3 animate-bounce">
            <span className="w-9 h-9 rounded-full bg-amber-500 text-amber-950 font-pirate font-black text-xl flex items-center justify-center border border-amber-300 shrink-0">
              E
            </span>
            <div className="text-left min-w-0">
              <div className="text-amber-300 text-xs font-bold uppercase tracking-wider truncate">
                {nearestChest.question.locationName || `Peti Harta #${nearestChest.question.number}`}
              </div>
              <div className="text-white font-bold text-xs sm:text-sm">
                {nearestChest.status === 'completed'
                  ? 'Peti Selesai! (Buka untuk meninjau)'
                  : nearestChest.status === 'locked'
                  ? 'Peti Terkunci! Selesaikan peti sebelumnya.'
                  : `Tekan [E] untuk Membuka Peti #${nearestChest.question.number}`}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Non-Solid Finish Ship Zone Banner (respects academic completion rule) */}
      {finishZoneNotice && !isPaused && !nearestChest && (
        <div className="absolute top-[156px] sm:top-20 left-1/2 -translate-x-1/2 pointer-events-none z-20 max-w-md w-[90%]">
          <div
            className={`px-5 py-3 rounded-2xl shadow-2xl backdrop-blur-xs border-2 text-center ${
              finishZoneNotice.ready
                ? 'bg-emerald-950/90 border-emerald-400 text-emerald-100'
                : 'bg-slate-950/90 border-amber-400 text-amber-100'
            }`}
          >
            <div className="text-xs font-extrabold uppercase tracking-wider text-amber-300 mb-0.5">
              ⚓ Kapal FINISH • Dermaga Akhir
            </div>
            <div className="text-xs sm:text-sm font-bold text-white">
              {finishZoneNotice.ready
                ? 'Semua peti soal selesai! Menuju layar kemenangan...'
                : `Selesaikan ${Math.max(0, finishZoneNotice.total - finishZoneNotice.completed)} peti soal lagi (${finishZoneNotice.completed}/${finishZoneNotice.total}) untuk berlayar menamatkan misi.`}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * 3D START Portal Gate with Wooden Pillars, Pirate Banner, and Lanterns
 */
function createStartGate(): THREE.Group {
  const gate = new THREE.Group();
  gate.position.set(0, 0, 6.0);

  const woodMat = new THREE.MeshStandardMaterial({
    color: 0x451a03,
    roughness: 0.8,
    metalness: 0.1,
  });

  // Pillars
  const pillarGeo = new THREE.CylinderGeometry(0.3, 0.35, 4.5, 10);
  const leftPillar = new THREE.Mesh(pillarGeo, woodMat);
  leftPillar.position.set(-3.5, 2.25, 0);
  gate.add(leftPillar);

  const rightPillar = new THREE.Mesh(pillarGeo, woodMat);
  rightPillar.position.set(3.5, 2.25, 0);
  gate.add(rightPillar);

  // Top Crossbeam
  const beamGeo = new THREE.BoxGeometry(7.8, 0.5, 0.5);
  const beam = new THREE.Mesh(beamGeo, woodMat);
  beam.position.set(0, 4.25, 0);
  gate.add(beam);

  // Banner Canvas Texture
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#78350f';
  ctx.fillRect(0, 0, 512, 128);

  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 500, 116);

  ctx.font = 'bold 36px Cinzel, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fef3c7';
  ctx.fillText('⚓ START • PIRATE ACADEMY ⚓', 256, 64);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const bannerGeo = new THREE.PlaneGeometry(5.8, 1.4);
  const bannerMat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.6,
    side: THREE.DoubleSide,
  });
  const banner = new THREE.Mesh(bannerGeo, bannerMat);
  banner.position.set(0, 4.25, 0.05);
  gate.add(banner);

  return gate;
}

/**
 * 3D FINISH Monument with Victory Pedestal, Golden Goal Beacon, and Flag
 */
function createFinishMonument(): THREE.Group {
  const fin = new THREE.Group();
  fin.position.set(FINISH_SHIP_AREA.monumentPos.x, 1.25, FINISH_SHIP_AREA.monumentPos.z);

  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.9,
    metalness: 0.1,
  });

  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xffd700,
    roughness: 0.2,
    metalness: 0.95,
    emissive: 0x78350f,
    emissiveIntensity: 0.4,
  });

  // Pedestal
  const baseGeo = new THREE.CylinderGeometry(2.0, 2.4, 0.8, 12);
  const base = new THREE.Mesh(baseGeo, stoneMat);
  base.position.y = 0.4;
  fin.add(base);

  const goldPlinth = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 0.4, 12), goldMat);
  goldPlinth.position.y = 1.0;
  fin.add(goldPlinth);

  // Victory Flagpole
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.08, 5.0, 8);
  const pole = new THREE.Mesh(poleGeo, goldMat);
  pole.position.set(0, 3.5, 0);
  fin.add(pole);

  // Victory Flag Canvas Texture
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 160;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#b91c1c';
  ctx.fillRect(0, 0, 256, 160);

  ctx.strokeStyle = '#ffd700';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 244, 148);

  ctx.font = 'bold 36px Cinzel, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('FINISH', 128, 55);

  ctx.font = 'bold 24px Cinzel, serif';
  ctx.fillStyle = '#fef08a';
  ctx.fillText('👑 JUARA 👑', 128, 110);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const flagGeo = new THREE.PlaneGeometry(2.2, 1.4);
  const flagMat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.5,
    side: THREE.DoubleSide,
  });
  const flag = new THREE.Mesh(flagGeo, flagMat);
  flag.position.set(1.15, 5.0, 0);
  fin.add(flag);

  // Emerald Goal Beacon
  const beaconLight = new THREE.PointLight(0x10b981, 2.5, 12);
  beaconLight.position.set(0, 2.5, 0);
  fin.add(beaconLight);

  return fin;
}

/**
 * Subtle non-solid golden-emerald embarking beacon ring on dry sand right in front of the Finish Ship
 */
function createFinishEmbarkRing(): THREE.Group {
  const ringGroup = new THREE.Group();
  ringGroup.position.set(FINISH_SHIP_AREA.triggerCenter.x, 1.03, FINISH_SHIP_AREA.triggerCenter.z);

  const outerGeo = new THREE.RingGeometry(2.6, 3.05, 48);
  outerGeo.rotateX(-Math.PI / 2);
  const outerMat = new THREE.MeshBasicMaterial({
    color: 0x10b981,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
  });
  ringGroup.add(new THREE.Mesh(outerGeo, outerMat));

  const innerGeo = new THREE.RingGeometry(1.5, 1.8, 36);
  innerGeo.rotateX(-Math.PI / 2);
  const innerMat = new THREE.MeshBasicMaterial({
    color: 0xfacc15,
    transparent: true,
    opacity: 0.65,
    side: THREE.DoubleSide,
  });
  ringGroup.add(new THREE.Mesh(innerGeo, innerMat));

  return ringGroup;
}
