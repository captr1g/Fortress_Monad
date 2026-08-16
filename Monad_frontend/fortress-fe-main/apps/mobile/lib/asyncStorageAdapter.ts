import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Storage } from "@reown/appkit-common-react-native";

// AppKit's Storage interface, backed by AsyncStorage — values round-trip
// through JSON since AsyncStorage itself only stores strings.
export const asyncStorageAdapter: Storage = {
  async getKeys() {
    return [...(await AsyncStorage.getAllKeys())];
  },
  async getEntries<T = unknown>() {
    const keys = await AsyncStorage.getAllKeys();
    const pairs = await AsyncStorage.multiGet(keys);
    return pairs.map(([key, value]) => [key, value ? (JSON.parse(value) as T) : undefined]) as [string, T][];
  },
  async getItem<T = unknown>(key: string) {
    const value = await AsyncStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : undefined;
  },
  async setItem<T = unknown>(key: string, value: T) {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  },
  async removeItem(key: string) {
    await AsyncStorage.removeItem(key);
  },
};
