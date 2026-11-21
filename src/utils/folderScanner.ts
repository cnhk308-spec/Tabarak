import { ExtractionResult } from '../types';

export interface DirectoryHandleLike {
  kind: 'directory';
  name: string;
  entries?: () => AsyncIterable<[string, DirectoryHandleLike | FileHandleLike]>;
  values?: () => AsyncIterable<DirectoryHandleLike | FileHandleLike>;
  queryPermission?: (desc: { mode: 'read' }) => Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission?: (desc: { mode: 'read' }) => Promise<'granted' | 'denied' | 'prompt'>;
}

export interface FileHandleLike {
  kind: 'file';
  name: string;
  getFile: () => Promise<File>;
}

const DB_NAME = 'mirsaad_folder_db';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'last_official_folder';

const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'bmp',
  'gif',
]);

export function isSupportedImageFile(file: File): boolean {
  if (file.name.startsWith('.') || file.name.startsWith('~$')) return false;
  if (file.type && file.type.startsWith('image/')) return true;
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return IMAGE_EXTENSIONS.has(ext);
}

export function isOfficialLetterResult(res: ExtractionResult | undefined): boolean {
  if (!res) return false;
  if ((res.issueNumberRaw || '').trim()) return true;
  if ((res.dateRaw || '').trim()) return true;
  if ((res.title || '').trim()) return true;
  if ((res.recipient || '').trim()) return true;
  if ((res.subject || '').trim()) return true;
  if ((res.issuingEntity || '').trim()) return true;
  if ((res.bodyContent || '').trim().length >= 15) return true;
  return false;
}

export function canUseNativeDirectoryPicker(): boolean {
  try {
    return (
      typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker ===
        'function' && window.self === window.top
    );
  } catch {
    return false;
  }
}

export function isMobileBrowser(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
}

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getSavedDirectoryHandle(): Promise<DirectoryHandleLike | null> {
  try {
    const db = await openHandleDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(HANDLE_KEY);
      req.onsuccess = () => resolve((req.result as DirectoryHandleLike) || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function saveDirectoryHandle(
  handle: DirectoryHandleLike | null
): Promise<void> {
  try {
    const db = await openHandleDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      if (handle) {
        store.put(handle, HANDLE_KEY);
      } else {
        store.delete(HANDLE_KEY);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Ignore storage failures
  }
}

export async function ensureDirectoryReadPermission(
  handle: DirectoryHandleLike
): Promise<boolean> {
  try {
    if (handle.queryPermission) {
      const state = await handle.queryPermission({ mode: 'read' });
      if (state === 'granted') return true;
    }
    if (handle.requestPermission) {
      const state = await handle.requestPermission({ mode: 'read' });
      return state === 'granted';
    }
    return true;
  } catch {
    return false;
  }
}

export async function collectImagesFromDirectoryHandle(
  dirHandle: DirectoryHandleLike,
  maxDepth = 5
): Promise<File[]> {
  const collected: File[] = [];

  async function walk(handle: DirectoryHandleLike, depth: number) {
    if (depth > maxDepth) return;
    const iterable = handle.values
      ? handle.values()
      : handle.entries
      ? (async function* () {
          for await (const [, entry] of handle.entries!()) {
            yield entry;
          }
        })()
      : null;

    if (!iterable) return;

    for await (const entry of iterable) {
      if (entry.kind === 'file') {
        try {
          const file = await entry.getFile();
          if (isSupportedImageFile(file)) {
            collected.push(file);
          }
        } catch {
          // Skip unreadable files
        }
      } else if (entry.kind === 'directory' && !entry.name.startsWith('.')) {
        await walk(entry, depth + 1);
      }
    }
  }

  await walk(dirHandle, 0);
  return collected.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}
