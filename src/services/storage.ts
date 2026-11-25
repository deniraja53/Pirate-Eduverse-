/**
 * Local cache & chest location constants for Pirate Academy: Treasure Quest
 * Primary source of truth is now the backend server (/api/*),
 * while localStorage caches the active student session ID for safe refresh recovery.
 * Created by Deni Raja99
 */

import type { SavedPlayerPose, StudentSession, TeacherSettings } from '../types/game';
import { ADVENTURE_PATH_WAYPOINTS, getDistributedChestsForQuestions } from '../game/ChestConfig';

const STORAGE_KEYS = {
  ACTIVE_SESSION_ID: 'pirate_academy_active_session_id_v4',
  ACTIVE_RECOVERY: 'pirate_academy_active_recovery_v1',
  SESSIONS: 'pirate_academy_sessions_v1',
};

export interface ActiveRecoveryState {
  sessionId: string;
  studentId: string;
  studentName: string;
  studentGrade: string;
  packageId: string;
  packageVersion: number;
  activeGameplay: boolean;
  lastPosition?: SavedPlayerPose;
  savedAt: string;
}

// Map-verified spatial chest presets along the 4 environmental zones
export const CHEST_PRESETS = ADVENTURE_PATH_WAYPOINTS.map((wp) => ({
  name: wp.name,
  zoneType: wp.zoneType,
  x: wp.x,
  y: wp.y,
  z: wp.z,
}));

export const DEFAULT_SETTINGS: TeacherSettings = {
  pin: '',
  googleSheetsWebAppUrl: '',
  autoSyncSheets: true,
  activePackageId: '',
};

export function getCachedSessionId(): string {
  try {
    return localStorage.getItem(STORAGE_KEYS.ACTIVE_SESSION_ID) || '';
  } catch {
    return '';
  }
}

export function setCachedSessionId(sessionId: string): void {
  try {
    if (sessionId) {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_SESSION_ID, sessionId);
    } else {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_SESSION_ID);
    }
  } catch {
    // ignore
  }
}

export function getActiveRecoveryState(): ActiveRecoveryState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ACTIVE_RECOVERY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveRecoveryState>;
    if (
      !parsed ||
      typeof parsed.sessionId !== 'string' ||
      !parsed.sessionId ||
      typeof parsed.packageId !== 'string' ||
      !parsed.packageId
    ) {
      return null;
    }
    return {
      sessionId: parsed.sessionId,
      studentId: parsed.studentId || '',
      studentName: parsed.studentName || '',
      studentGrade: parsed.studentGrade || '',
      packageId: parsed.packageId,
      packageVersion: typeof parsed.packageVersion === 'number' ? parsed.packageVersion : 1,
      activeGameplay: Boolean(parsed.activeGameplay),
      lastPosition: parsed.lastPosition,
      savedAt: parsed.savedAt || '',
    };
  } catch {
    return null;
  }
}

export function saveActiveRecoveryState(state: ActiveRecoveryState): void {
  try {
    setCachedSessionId(state.sessionId);
    localStorage.setItem(STORAGE_KEYS.ACTIVE_RECOVERY, JSON.stringify(state));
  } catch {
    // ignore storage quota errors
  }
}

export function updateLocalRecoveryPose(sessionId: string, pose: SavedPlayerPose): void {
  try {
    const current = getActiveRecoveryState();
    if (!current || current.sessionId !== sessionId) return;
    current.lastPosition = pose;
    current.savedAt = pose.updatedAt || new Date().toISOString();
    localStorage.setItem(STORAGE_KEYS.ACTIVE_RECOVERY, JSON.stringify(current));
  } catch {
    // ignore
  }
}

export function clearActiveRecoveryState(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_RECOVERY);
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_SESSION_ID);
  } catch {
    // ignore
  }
}

export function getStudentSessions(): StudentSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SESSIONS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveStudentSession(session: StudentSession): void {
  try {
    setCachedSessionId(session.sessionId);
    const sessions = getStudentSessions();
    const idx = sessions.findIndex((s) => s.sessionId === session.sessionId);
    if (idx >= 0) {
      sessions[idx] = session;
    } else {
      sessions.unshift(session);
    }
    localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(sessions.slice(0, 20)));
  } catch {
    // ignore storage quota errors
  }
}

export function computeChestLocationForIndex(idx: number, totalQuestions: number) {
  const list = getDistributedChestsForQuestions(Math.max(1, totalQuestions));
  const wp = list[Math.min(Math.max(idx, 0), list.length - 1)];
  return {
    name: wp.name,
    zoneType: wp.zoneType,
    x: wp.x,
    y: wp.y,
    z: wp.z,
  };
}

