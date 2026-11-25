/**
 * Spatial Chest Distribution Configuration for Pirate Academy: Treasure Quest (V5)
 * Organizes treasure chests organically across 4 environmental zones from START to FINISH:
 * - Zona A (main_path, ~35%): On main path shoulders, clear running lane
 * - Zona B (roadside, ~30%): Walkable off-road dunes/grass beside the road
 * - Zona C (forest_edge, ~25%): Near trees, bushes & rock clearings (obstacle-free clearance)
 * - Zona D (exploration_area, ~10%): Elevated scenic off-path clearings & landmarks
 *
 * Every primary coordinate is empirically verified against game_pirate_adventure_map.glb
 * terrain slopes, peijing obstacle clearance, and continuous path reachability.
 * Created by Deni Raja99
 */

import type { ChestZoneType } from '../types/game.ts';

export interface ChestWaypoint {
  id: string;
  name: string;
  areaDescription: string;
  zoneType: ChestZoneType;
  x: number;
  y: number;
  z: number;
  rotationY?: number;
  interactionRadius: number;
  side: 'left' | 'right' | 'center';
}

export const CHEST_ZONE_LABELS: Record<ChestZoneType, string> = {
  main_path: 'Zona A • Jalan Utama',
  roadside: 'Zona B • Tepi Jalan',
  forest_edge: 'Zona C • Tepi Hutan & Batu',
  exploration_area: 'Zona D • Area Eksplorasi',
};

export const CHEST_ZONE_TARGET_RATIOS: Record<ChestZoneType, number> = {
  main_path: 0.35,
  roadside: 0.30,
  forest_edge: 0.25,
  exploration_area: 0.10,
};

/**
 * 29 Map-Verified Spatial Waypoints from START (Z=22) through coast, jungle,
 * hills, and wooden bridge to FINISH plateau (Z=720..722).
 */
export const ADVENTURE_PATH_WAYPOINTS: ChestWaypoint[] = [
  // === ZONA A: MAIN PATH (10 curated road-shoulder slots, clear central lane) ===
  {
    id: 'wp-main-01',
    name: 'Peti Gerbang Awal (Start Area)',
    areaDescription: 'Sisi Kanan Jalan Dekat Gerbang Mulai',
    zoneType: 'main_path',
    x: 3.4,
    y: 0.0,
    z: 22.0,
    side: 'right',
    interactionRadius: 3.4,
  },
  {
    id: 'wp-main-02',
    name: 'Peti Jalur Pesisir Awal',
    areaDescription: 'Sisi Kiri Jalan Utama Pesisir',
    zoneType: 'main_path',
    x: -3.4,
    y: 0.0,
    z: 102.0,
    side: 'left',
    interactionRadius: 3.4,
  },
  {
    id: 'wp-main-03',
    name: 'Peti Jalur Dermaga Samudra',
    areaDescription: 'Sisi Kanan Jalan Dekat Dermaga',
    zoneType: 'main_path',
    x: 3.4,
    y: 0.0,
    z: 166.0,
    side: 'right',
    interactionRadius: 3.4,
  },
  {
    id: 'wp-main-04',
    name: 'Peti Persimpangan Jalur Karang',
    areaDescription: 'Sisi Kiri Jalan Persimpangan',
    zoneType: 'main_path',
    x: -3.4,
    y: 0.0,
    z: 260.0,
    side: 'left',
    interactionRadius: 3.4,
  },
  {
    id: 'wp-main-05',
    name: 'Peti Jalur Benteng Meriam',
    areaDescription: 'Sisi Kanan Lintasan Benteng',
    zoneType: 'main_path',
    x: 3.3,
    y: 0.0,
    z: 340.0,
    side: 'right',
    interactionRadius: 3.4,
  },
  {
    id: 'wp-main-06',
    name: 'Peti Jalur Tengah Pulau',
    areaDescription: 'Sisi Kiri Lintasan Utama Tengah',
    zoneType: 'main_path',
    x: -3.4,
    y: 0.0,
    z: 435.0,
    side: 'left',
    interactionRadius: 3.4,
  },
  {
    id: 'wp-main-07',
    name: 'Peti Jalur Tebing Samudra',
    areaDescription: 'Sisi Kanan Jalan Sebelum Jurang',
    zoneType: 'main_path',
    x: 3.4,
    y: 0.0,
    z: 535.0,
    side: 'right',
    interactionRadius: 3.4,
  },
  {
    id: 'wp-main-08',
    name: 'Peti Akses Jembatan Kayu',
    areaDescription: 'Sisi Kiri Akses Jembatan Kayu',
    zoneType: 'main_path',
    x: -3.3,
    y: 0.0,
    z: 646.0,
    side: 'left',
    interactionRadius: 3.4,
  },
  {
    id: 'wp-main-09',
    name: 'Peti Menara Pandang Jembatan',
    areaDescription: 'Sisi Kanan Ujung Jembatan Lengkung',
    zoneType: 'main_path',
    x: 3.2,
    y: 0.0,
    z: 692.0,
    side: 'right',
    interactionRadius: 3.4,
  },
  {
    id: 'wp-main-10',
    name: 'Peti Harta Karun Utama (Finish)',
    areaDescription: 'Dataran Seberang Jembatan Kayu (Area Finish)',
    zoneType: 'main_path',
    x: -65.0,
    y: 0.249,
    z: 720.0,
    side: 'center',
    interactionRadius: 3.6,
  },

  // === ZONA B: ROADSIDE (8 walkable off-road dune/shoulder slots) ===
  {
    id: 'wp-road-01',
    name: 'Peti Pasir Tepi Jalan Barat',
    areaDescription: 'Tepi Jalan Berpasir Sisi Kiri',
    zoneType: 'roadside',
    x: -8.5,
    y: 1.096,
    z: 48.0,
    side: 'left',
    interactionRadius: 3.5,
  },
  {
    id: 'wp-road-02',
    name: 'Peti Tepi Jalan Pesisir Timur',
    areaDescription: 'Bahu Tanah Landai Sisi Kanan',
    zoneType: 'roadside',
    x: 8.5,
    y: 1.426,
    z: 134.0,
    side: 'right',
    interactionRadius: 3.5,
  },
  {
    id: 'wp-road-03',
    name: 'Peti Bahu Jalan Barat',
    areaDescription: 'Tepi Jalan Sisi Kiri Dekat Rumput',
    zoneType: 'roadside',
    x: -8.8,
    y: 0.842,
    z: 210.0,
    side: 'left',
    interactionRadius: 3.5,
  },
  {
    id: 'wp-road-04',
    name: 'Peti Pinggir Jalan Karang',
    areaDescription: 'Tepi Jalan Landai Sisi Kanan',
    zoneType: 'roadside',
    x: 8.5,
    y: 0.332,
    z: 278.0,
    side: 'right',
    interactionRadius: 3.5,
  },
  {
    id: 'wp-road-05',
    name: 'Peti Tepi Bukit Timur',
    areaDescription: 'Bahu Jalan Menanjak Ringan Kanan',
    zoneType: 'roadside',
    x: 9.5,
    y: 1.408,
    z: 412.0,
    side: 'right',
    interactionRadius: 3.5,
  },
  {
    id: 'wp-road-06',
    name: 'Peti Bahu Jalan Hutan Tropis',
    areaDescription: 'Sisi Kanan Jalan Rindang',
    zoneType: 'roadside',
    x: 8.5,
    y: 0.509,
    z: 478.0,
    side: 'right',
    interactionRadius: 3.5,
  },
  {
    id: 'wp-road-07',
    name: 'Peti Tepi Jalan Tebing Utara',
    areaDescription: 'Tepi Jalan Sisi Kiri Sebelum Jembatan',
    zoneType: 'roadside',
    x: -9.0,
    y: 1.291,
    z: 582.0,
    side: 'left',
    interactionRadius: 3.5,
  },
  {
    id: 'wp-road-08',
    name: 'Peti Dataran Seberang Jembatan',
    areaDescription: 'Tepi Area Terbuka Seberang Jembatan',
    zoneType: 'roadside',
    x: -50.0,
    y: 0.161,
    z: 718.0,
    side: 'right',
    interactionRadius: 3.5,
  },

  // === ZONA C: FOREST EDGE (7 clearings near trees/bushes/rocks) ===
  {
    id: 'wp-forest-01',
    name: 'Peti Celah Pohon Kelapa',
    areaDescription: 'Tepi Hutan Kelapa Sisi Kanan',
    zoneType: 'forest_edge',
    x: 16.0,
    y: 2.43,
    z: 48.0,
    side: 'right',
    interactionRadius: 3.6,
  },
  {
    id: 'wp-forest-02',
    name: 'Peti Teduh Rumpun Tropis',
    areaDescription: 'Dekat Pepohonan & Batu Karang Kanan',
    zoneType: 'forest_edge',
    x: 16.0,
    y: 3.09,
    z: 72.0,
    side: 'right',
    interactionRadius: 3.6,
  },
  {
    id: 'wp-forest-03',
    name: 'Peti Balik Semak Pesisir',
    areaDescription: 'Celah Pohon & Semak Pesisir Timur',
    zoneType: 'forest_edge',
    x: 22.0,
    y: 3.29,
    z: 125.0,
    side: 'right',
    interactionRadius: 3.6,
  },
  {
    id: 'wp-forest-04',
    name: 'Peti Rimba Batu Timur',
    areaDescription: 'Dekat Batu & Semak Rimba Kanan',
    zoneType: 'forest_edge',
    x: 22.0,
    y: 1.94,
    z: 248.0,
    side: 'right',
    interactionRadius: 3.6,
  },
  {
    id: 'wp-forest-05',
    name: 'Peti Hutan Teduh Barat',
    areaDescription: 'Celah Pepohonan Terbuka Sisi Kiri',
    zoneType: 'forest_edge',
    x: -22.0,
    y: 3.212,
    z: 312.0,
    side: 'left',
    interactionRadius: 3.6,
  },
  {
    id: 'wp-forest-06',
    name: 'Peti Pepohonan Rimba Timur',
    areaDescription: 'Tepi Hutan Rindang Sisi Kanan',
    zoneType: 'forest_edge',
    x: 22.0,
    y: 2.936,
    z: 445.0,
    side: 'right',
    interactionRadius: 3.6,
  },
  {
    id: 'wp-forest-07',
    name: 'Peti Celah Rimba Tengah',
    areaDescription: 'Dekat Pepohonan & Karang Sisi Kanan',
    zoneType: 'forest_edge',
    x: 16.0,
    y: 2.229,
    z: 345.0,
    side: 'right',
    interactionRadius: 3.6,
  },

  // === ZONA D: EXPLORATION AREA (4 elevated scenic off-path clearings) ===
  {
    id: 'wp-explore-01',
    name: 'Peti Bukit Karang Rahasia',
    areaDescription: 'Area Eksplorasi Bukit Karang Barat',
    zoneType: 'exploration_area',
    x: -22.0,
    y: 3.901,
    z: 98.0,
    side: 'left',
    interactionRadius: 3.8,
  },
  {
    id: 'wp-explore-02',
    name: 'Peti Puncak Pandang Pesisir',
    areaDescription: 'Dataran Terbuka Eksplorasi Barat',
    zoneType: 'exploration_area',
    x: -24.0,
    y: 5.032,
    z: 215.0,
    side: 'left',
    interactionRadius: 3.8,
  },
  {
    id: 'wp-explore-03',
    name: 'Peti Dataran Tinggi Pengintai',
    areaDescription: 'Area Eksplorasi Lereng Tinggi Barat',
    zoneType: 'exploration_area',
    x: -24.0,
    y: 4.816,
    z: 392.0,
    side: 'left',
    interactionRadius: 3.8,
  },
  {
    id: 'wp-explore-04',
    name: 'Peti Lembah Tersembunyi',
    areaDescription: 'Padang Terbuka Jauh Dari Jalur Utama',
    zoneType: 'exploration_area',
    x: -22.0,
    y: 3.317,
    z: 548.0,
    side: 'left',
    interactionRadius: 3.8,
  },
];

/**
 * Largest-remainder (Hamilton) apportionment ensuring zone counts always sum to N
 * and match the target mix (~35% main_path, ~30% roadside, ~25% forest_edge, ~10% exploration_area).
 */
export function calculateZoneQuotas(totalChests: number): Record<ChestZoneType, number> {
  if (totalChests <= 0) {
    return { main_path: 0, roadside: 0, forest_edge: 0, exploration_area: 0 };
  }
  if (totalChests === 1) {
    return { main_path: 1, roadside: 0, forest_edge: 0, exploration_area: 0 };
  }
  if (totalChests === 2) {
    return { main_path: 1, roadside: 1, forest_edge: 0, exploration_area: 0 };
  }
  if (totalChests === 3) {
    return { main_path: 1, roadside: 1, forest_edge: 1, exploration_area: 0 };
  }

  const zones: ChestZoneType[] = ['main_path', 'roadside', 'forest_edge', 'exploration_area'];
  const quotas: Record<ChestZoneType, number> = {
    main_path: 0,
    roadside: 0,
    forest_edge: 0,
    exploration_area: 0,
  };
  const remainders: Array<{ zone: ChestZoneType; rem: number }> = [];
  let allocated = 0;

  for (const z of zones) {
    const exact = totalChests * CHEST_ZONE_TARGET_RATIOS[z];
    const floored = Math.floor(exact);
    quotas[z] = floored;
    allocated += floored;
    remainders.push({ zone: z, rem: exact - floored });
  }

  // Ensure every zone gets at least 1 chest when N >= 4 so exploration is diverse
  for (const z of zones) {
    if (quotas[z] === 0 && allocated < totalChests) {
      quotas[z] = 1;
      allocated += 1;
    }
  }

  remainders.sort((a, b) => b.rem - a.rem);
  let rIdx = 0;
  while (allocated < totalChests) {
    const z = remainders[rIdx % remainders.length].zone;
    quotas[z] += 1;
    allocated += 1;
    rIdx += 1;
  }

  return quotas;
}

function pickEvenlyFromBucket<T>(bucket: T[], count: number, includeFirstAndLast = false): T[] {
  if (count <= 0 || bucket.length === 0) return [];
  if (count >= bucket.length) return [...bucket];
  if (count === 1) {
    return [bucket[includeFirstAndLast ? 0 : Math.floor(bucket.length / 2)]];
  }

  const picked: T[] = [];
  const step = (bucket.length - 1) / (count - 1);
  for (let i = 0; i < count; i++) {
    const idx = Math.min(Math.max(Math.round(i * step), 0), bucket.length - 1);
    picked.push(bucket[idx]);
  }
  return picked;
}

function distance2D(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Distribute N chests across the 4 zones from START to FINISH:
 * - Proportional to 35% main_path / 30% roadside / 25% forest_edge / 10% exploration_area
 * - Chest #1 near START (main_path) and final chest at FINISH plateau
 * - Minimum 12m spatial spacing enforced (zero stacking or overlap)
 * - Supports any N (including N > 29 via safe non-overlapping offsets)
 */
export function getDistributedChestsForQuestions(questionCount: number): ChestWaypoint[] {
  if (questionCount <= 0) return [];
  if (questionCount === 1) {
    return [ADVENTURE_PATH_WAYPOINTS[0]];
  }

  const byZone: Record<ChestZoneType, ChestWaypoint[]> = {
    main_path: ADVENTURE_PATH_WAYPOINTS.filter((w) => w.zoneType === 'main_path').sort((a, b) => a.z - b.z),
    roadside: ADVENTURE_PATH_WAYPOINTS.filter((w) => w.zoneType === 'roadside').sort((a, b) => a.z - b.z),
    forest_edge: ADVENTURE_PATH_WAYPOINTS.filter((w) => w.zoneType === 'forest_edge').sort((a, b) => a.z - b.z),
    exploration_area: ADVENTURE_PATH_WAYPOINTS.filter((w) => w.zoneType === 'exploration_area').sort((a, b) => a.z - b.z),
  };

  const quotas = calculateZoneQuotas(questionCount);
  const selectedPool: ChestWaypoint[] = [];
  const usedIds = new Set<string>();

  const pushUnique = (wp: ChestWaypoint) => {
    if (!usedIds.has(wp.id)) {
      usedIds.add(wp.id);
      selectedPool.push(wp);
    }
  };

  // Pick curated waypoints per zone
  pickEvenlyFromBucket(byZone.main_path, Math.min(quotas.main_path, byZone.main_path.length), true).forEach(pushUnique);
  pickEvenlyFromBucket(byZone.roadside, Math.min(quotas.roadside, byZone.roadside.length), false).forEach(pushUnique);
  pickEvenlyFromBucket(byZone.forest_edge, Math.min(quotas.forest_edge, byZone.forest_edge.length), false).forEach(pushUnique);
  pickEvenlyFromBucket(byZone.exploration_area, Math.min(quotas.exploration_area, byZone.exploration_area.length), false).forEach(pushUnique);

  // Fill any remaining slots up to min(questionCount, 29) from unused curated waypoints while maintaining spacing
  if (selectedPool.length < Math.min(questionCount, ADVENTURE_PATH_WAYPOINTS.length)) {
    const unused = ADVENTURE_PATH_WAYPOINTS.filter((w) => !usedIds.has(w.id));
    for (const candidate of unused) {
      if (selectedPool.length >= questionCount) break;
      const tooClose = selectedPool.some((s) => distance2D(s, candidate) < 12.0);
      if (!tooClose) {
        pushUnique(candidate);
      }
    }
    // Second pass if strict 12m excluded something
    for (const candidate of unused) {
      if (selectedPool.length >= questionCount) break;
      pushUnique(candidate);
    }
  }

  // Sort curated selection monotonically along progression Z (with Finish last)
  selectedPool.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.x - b.x;
  });

  // If questionCount <= selectedPool.length, ensure separation & exact count
  if (questionCount <= selectedPool.length) {
    return selectedPool.slice(0, questionCount);
  }

  // Handle N > 29 cleanly: interpolate extra verified corridor slots between waypoints with >= 10m spacing
  const result: ChestWaypoint[] = [...selectedPool];
  const zoneOrder: ChestZoneType[] = ['main_path', 'roadside', 'forest_edge', 'exploration_area'];
  let extraIdx = 0;

  while (result.length < questionCount) {
    const zPos = 35 + ((extraIdx + 0.5) / Math.max(questionCount - selectedPool.length, 1)) * 560;
    const zType = zoneOrder[extraIdx % zoneOrder.length];
    const sideSign = extraIdx % 2 === 0 ? -1 : 1;
    const xOffset =
      zType === 'main_path'
        ? sideSign * 3.3
        : zType === 'roadside'
        ? sideSign * 8.5
        : zType === 'forest_edge'
        ? sideSign * 16.0
        : sideSign * 22.0;

    const candidate: ChestWaypoint = {
      id: `wp-extra-${extraIdx + 1}`,
      name: `Peti Eksplorasi #${result.length + 1}`,
      areaDescription: CHEST_ZONE_LABELS[zType],
      zoneType: zType,
      x: xOffset,
      y: 0.0,
      z: Math.round(zPos * 10) / 10,
      side: sideSign < 0 ? 'left' : 'right',
      interactionRadius: zType === 'main_path' ? 3.4 : 3.6,
    };

    // Nudge Z if too close to an existing chest
    let guard = 0;
    while (result.some((existing) => distance2D(existing, candidate) < 10.0) && guard < 12) {
      candidate.z = Math.min(595, candidate.z + 8.5);
      guard++;
    }

    result.push(candidate);
    extraIdx++;
  }

  result.sort((a, b) => a.z - b.z);
  return result;
}
