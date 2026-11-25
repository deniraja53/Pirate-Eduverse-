/**
 * Google Drive & Google Picker Client Integration (Firebase Auth + In-Memory Token)
 * Follows Google Workspace integration security guidelines:
 * - Access token cached strictly in memory (never localStorage/sessionStorage)
 * - Clears cached token on Firebase Auth sign-out
 * - Loads Google Picker widget dynamically on demand without hardcoded API/developer keys
 * Created by Deni Raja99
 */

import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Minimal per-file scope: only grants access to files the teacher explicitly selects in Google Picker
export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
] as const;

const isFirebaseConfigured = Boolean(
  firebaseConfig &&
    firebaseConfig.apiKey &&
    firebaseConfig.projectId &&
    firebaseConfig.authDomain
);

const app = isFirebaseConfigured
  ? getApps().length > 0
    ? getApp()
    : initializeApp(firebaseConfig)
  : null;
const auth = app ? getAuth(app) : null;

const provider = new GoogleAuthProvider();
DRIVE_SCOPES.forEach((scope) => provider.addScope(scope));

let isSigningIn = false;
let cachedAccessToken: string | null = null;
let pickerScriptPromise: Promise<void> | null = null;

export function getGoogleDriveConfigStatus(): {
  configured: boolean;
  projectId: string;
  hasOAuthClientId: boolean;
} {
  return {
    configured: isFirebaseConfigured,
    projectId: firebaseConfig?.projectId || '',
    hasOAuthClientId: Boolean(firebaseConfig?.oAuthClientId),
  };
}

export function initGoogleDriveAuth(
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
): () => void {
  if (!auth) {
    onAuthFailure?.();
    return () => {};
  }

  return onAuthStateChanged(auth, (user) => {
    if (user) {
      if (cachedAccessToken) {
        onAuthSuccess?.(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        onAuthFailure?.();
      }
    } else {
      cachedAccessToken = null;
      onAuthFailure?.();
    }
  });
}

export async function signInGoogleDrive(): Promise<{ user: User; accessToken: string }> {
  if (!auth) {
    throw new Error('Konfigurasi Google OAuth belum tersedia di aplikasi ini.');
  }

  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Token akses Google Drive tidak diterima dari proses login.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
}

export function getCachedDriveAccessToken(): string | null {
  return cachedAccessToken;
}

export async function signOutGoogleDrive(): Promise<void> {
  cachedAccessToken = null;
  if (auth) {
    await auth.signOut();
  }
}

interface GooglePickerDoc {
  id?: string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number | string;
}

interface GooglePickerCallbackData {
  action?: string;
  docs?: GooglePickerDoc[];
}

interface GooglePickerBuilder {
  addView: (view: unknown) => GooglePickerBuilder;
  setOAuthToken: (token: string) => GooglePickerBuilder;
  setCallback: (cb: (data: GooglePickerCallbackData) => void) => GooglePickerBuilder;
  setOrigin: (origin: string) => GooglePickerBuilder;
  setTitle: (title: string) => GooglePickerBuilder;
  build: () => { setVisible: (visible: boolean) => void };
}

declare global {
  interface Window {
    gapi?: {
      load: (api: string, cb: () => void) => void;
    };
    google?: {
      picker?: {
        ViewId: {
          DOCS: unknown;
        };
        Action: {
          PICKED: string;
          CANCEL: string;
          ERROR?: string;
        };
        DocsView: new (viewId?: unknown) => {
          setMimeTypes: (mimes: string) => unknown;
          setIncludeFolders: (flag: boolean) => unknown;
        };
        PickerBuilder: new () => GooglePickerBuilder;
      };
    };
  }
}

function loadGooglePickerApi(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Picker hanya berjalan di browser.'));
  }
  if (window.google?.picker) {
    return Promise.resolve();
  }
  if (pickerScriptPromise) {
    return pickerScriptPromise;
  }

  pickerScriptPromise = new Promise<void>((resolve, reject) => {
    const finishLoad = () => {
      if (!window.gapi) {
        reject(new Error('Skrip Google API (gapi) gagal dimuat.'));
        return;
      }
      window.gapi.load('picker', () => {
        if (window.google?.picker) {
          resolve();
        } else {
          reject(new Error('Modul Google Picker tidak tersedia setelah gapi dimuat.'));
        }
      });
    };

    const existing = document.querySelector<HTMLScriptElement>('script[data-google-apis="true"]');
    if (existing) {
      if (window.gapi) {
        finishLoad();
      } else {
        existing.addEventListener('load', finishLoad, { once: true });
        existing.addEventListener(
          'error',
          () => reject(new Error('Gagal memuat skrip Google Picker dari internet.')),
          { once: true }
        );
      }
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.defer = true;
    script.dataset.googleApis = 'true';
    script.onload = finishLoad;
    script.onerror = () => reject(new Error('Gagal memuat skrip Google Picker dari apis.google.com.'));
    document.head.appendChild(script);
  }).catch((err) => {
    pickerScriptPromise = null;
    throw err;
  });

  return pickerScriptPromise;
}

export interface PickedDriveFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
}

export async function openGoogleDrivePicker(
  accessToken: string
): Promise<PickedDriveFile | null> {
  await loadGooglePickerApi();
  const pickerApi = window.google?.picker;
  if (!pickerApi) {
    throw new Error('Google Picker tidak tersedia di browser.');
  }

  const pickerOrigin =
    window.location.ancestorOrigins && window.location.ancestorOrigins.length > 0
      ? window.location.ancestorOrigins[window.location.ancestorOrigins.length - 1]
      : window.location.origin;

  return new Promise<PickedDriveFile | null>((resolve, reject) => {
    const docsView = new pickerApi.DocsView(pickerApi.ViewId.DOCS);
    docsView.setIncludeFolders(true);
    docsView.setMimeTypes(
      [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword',
        'application/vnd.google-apps.document',
      ].join(',')
    );

    const picker = new pickerApi.PickerBuilder()
      .addView(docsView)
      .setOAuthToken(accessToken)
      .setOrigin(pickerOrigin)
      .setTitle('Pilih File Soal (PDF / Word / Google Docs, Maks 2 MB)')
      .setCallback((data: GooglePickerCallbackData) => {
        if (data.action === pickerApi.Action.PICKED && Array.isArray(data.docs) && data.docs[0]) {
          const doc = data.docs[0];
          resolve({
            id: String(doc.id),
            name: String(doc.name || 'Dokumen Drive'),
            mimeType: String(doc.mimeType || ''),
            sizeBytes: doc.sizeBytes ? Number(doc.sizeBytes) : undefined,
          });
        } else if (data.action === pickerApi.Action.CANCEL) {
          resolve(null);
        } else if (data.action === (pickerApi.Action.ERROR || 'error')) {
          reject(
            new Error(
              'Google Picker gagal memuat file. Pastikan izin akses file (drive.file) telah disetujui saat masuk dengan Google.'
            )
          );
        }
      })
      .build();

    picker.setVisible(true);
  });
}
