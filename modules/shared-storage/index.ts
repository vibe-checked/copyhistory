import { requireNativeModule } from 'expo-modules-core';

type SharedStorageModule = {
  getPendingItems(): Promise<string[]>;
  clearPendingItems(): Promise<void>;
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
