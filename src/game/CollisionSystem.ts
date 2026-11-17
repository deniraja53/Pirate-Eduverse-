/**
 * Collision and Island Geography System for Pirate Academy
 * Handles island elevation, terrain slope, water boundaries, and obstacle collisions
 */

export interface Obstacle {
  x: number;
  z: number;
  radius: number;
  type: string;
}

export class CollisionSystem {
  public islandRadius: number = 28;
  public obstacles: Obstacle[] = [];

  constructor() {
    this.initObstacles();
  }

  private initObstacles() {
    // Rocky hill and ruins
    this.obstacles.push(
      { x: 0, z: -16, radius: 4.2, type: 'skull_rock' },
      { x: -14, z: -8, radius: 2.5, type: 'ruins' },
      { x: 12, z: 8, radius: 1.8, type: 'dock_crane' },
      // Rock barriers around island perimeter
      { x: 20, z: -10, radius: 3.0, type: 'cliff' },
      { x: -22, z: -5, radius: 3.5, type: 'cliff' },
      { x: -18, z: 12, radius: 2.8, type: 'cliff' }
    );
  }

  /**
   * Calculate ground height at given world coordinates (x, z)
   */
  public getGroundHeight(x: number, z: number): number {
    const distFromCenter = Math.sqrt(x * x + z * z);
    
    // Central hill & skull rock region (around z = -14 to -18)
    const skullDist = Math.sqrt(x * x + (z + 16) * (z + 16));
    if (skullDist < 8) {
      return 1.8 + Math.max(0, (8 - skullDist) * 0.45);
    }

    // Dock region (extended wooden pier towards x=12, z=8)
    if (x > 8 && x < 16 && z > 4 && z < 14) {
      return 1.1; // flat elevated wooden dock
    }

    // General island bell-shaped elevation
    if (distFromCenter < this.islandRadius) {
      const normalized = 1 - distFromCenter / this.islandRadius;
      // Gentle slope with some undulating dunes
      const baseHeight = 0.5 + Math.pow(normalized, 1.6) * 2.2;
      const dunes = Math.sin(x * 0.25) * Math.cos(z * 0.25) * 0.2;
      return Math.max(0.4, baseHeight + dunes);
    }

    // In water / off island
    return 0.1;
  }

  /**
   * Check and resolve character position against boundaries and obstacles
   */
  public resolvePosition(currentX: number, currentZ: number, targetX: number, targetZ: number, charRadius: number = 0.6): { x: number; z: number } {
    let newX = targetX;
    let newZ = targetZ;

    // 1. Keep within safe island radius (prevent falling into deep ocean)
    const dist = Math.sqrt(newX * newX + newZ * newZ);
    // Allow slight extension for the dock
    const isNearDock = newX > 6 && newX < 18 && newZ > 2 && newZ < 16;
    const maxRadius = isNearDock ? this.islandRadius + 4 : this.islandRadius - 1.5;

    if (dist > maxRadius) {
      const angle = Math.atan2(newZ, newX);
      newX = Math.cos(angle) * maxRadius;
      newZ = Math.sin(angle) * maxRadius;
    }

    // 2. Resolve against obstacles
    for (const obs of this.obstacles) {
      const dx = newX - obs.x;
      const dz = newZ - obs.z;
      const obsDist = Math.sqrt(dx * dx + dz * dz);
      const minDist = obs.radius + charRadius;

      if (obsDist < minDist && obsDist > 0.001) {
        // Push character out radially
        const pushX = (dx / obsDist) * minDist;
        const pushZ = (dz / obsDist) * minDist;
        newX = obs.x + pushX;
        newZ = obs.z + pushZ;
      }
    }

    return { x: newX, z: newZ };
  }
}
