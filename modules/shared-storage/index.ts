import { requireNativeModule } from 'expo-modules-core';

type SharedStorageModule = {
  getPendingItems(): Promise<string[]>;
  clearPendingItems(): Promise<void>;
  setSnippets(json: string): Promise<void>;
  setRecentEntries(json: string): Promise<void>;
  isKeyboardActive(): Promise<boolean>;
};

let SharedStorage: SharedStorageModule | null = null;
try {
  SharedStorage = requireNativeModule<SharedStorageModule>('SharedStorage');
} catch {
  // Not available in Expo Go or web builds
}

export async function getPendingItems(): Promise<string[]> {
  return SharedStorage ? SharedStorage.getPendingItems() : [];
}

export async function clearPendingItems(): Promise<void> {
  if (SharedStorage) await SharedStorage.clearPendingItems();
}

export async function setSnippets(json: string): Promise<void> {
  if (SharedStorage) await SharedStorage.setSnippets(json);
}

export async function setRecentEntries(json: string): Promise<void> {
  if (SharedStorage) await SharedStorage.setRecentEntries(json);
}

export async function isKeyboardActive(): Promise<boolean> {
  return SharedStorage ? SharedStorage.isKeyboardActive() : false;
}
