/**
 * Local cache & chest location constants for Pirate Academy: Treasure Quest
 * Primary source of truth is now the backend server (/api/*),
 * while localStorage caches the active student session ID for safe refresh recovery.
 * Created by Deni Raja99
 */

import type { QuestionPackage, StudentSession, TeacherSettings } from '../types/game';
import { ADVENTURE_PATH_WAYPOINTS, getDistributedChestsForQuestions } from '../game/ChestConfig';

const STORAGE_KEYS = {
  ACTIVE_SESSION_ID: 'pirate_academy_active_session_id_v4',
  SESSIONS: 'pirate_academy_sessions_v1',
};

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

export function clearEmptyPackage(): QuestionPackage | null {
  return null;
}
