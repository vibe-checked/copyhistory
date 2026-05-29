import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  AppStateStatus,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const STORAGE_KEY = 'copyhistory:entries:v1';
const MAX_ENTRIES = 500;

type Entry = {
  id: string;
  text: string;
  copiedAt: number;
};

export default function App() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const entriesRef = useRef<Entry[]>([]);
  const internalCopyRef = useRef<string | null>(null);

  const trimmedQuery = query.trim();
  const visible = trimmedQuery
    ? entries.filter((e) =>
        e.text.toLowerCase().includes(trimmedQuery.toLowerCase()),
      )
    : entries;
  const isFiltering = trimmedQuery.length > 0;

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) setEntries(JSON.parse(raw));
      } catch (e) {
        console.warn('Failed to load history', e);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries)).catch((e) =>
      console.warn('Failed to persist history', e),
    );
  }, [entries, loaded]);

  const captureCurrentClipboard = useCallback(async () => {
    try {
      if (!(await Clipboard.hasStringAsync())) return;
      const text = await Clipboard.getStringAsync();
      if (!text) return;
      if (internalCopyRef.current === text) {
        internalCopyRef.current = null;
        return;
      }
      const current = entriesRef.current;
      if (current[0]?.text === text) return;
      const next: Entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text,
        copiedAt: Date.now(),
      };
      setEntries((prev) => [next, ...prev].slice(0, MAX_ENTRIES));
    } catch (e) {
      console.warn('Failed to read clipboard', e);
    }
  }, []);

  useEffect(() => {
    if (!loaded) return;
    captureCurrentClipboard();
    const sub = Clipboard.addClipboardListener(({ contentTypes }) => {
      if (contentTypes.includes(Clipboard.ContentType.PLAIN_TEXT)) {
        captureCurrentClipboard();
      }
    });
    return () => sub.remove();
  }, [loaded, captureCurrentClipboard]);

  useEffect(() => {
    if (!loaded) return;
    const onChange = (state: AppStateStatus) => {
      if (state === 'active') captureCurrentClipboard();
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [loaded, captureCurrentClipboard]);

  const copyBack = useCallback(async (text: string) => {
    internalCopyRef.current = text;
    await Clipboard.setStringAsync(text);
  }, []);

  const deleteEntry = useCallback((id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    if (entries.length === 0) return;
    Alert.alert('Clear history?', `Delete all ${entries.length} entries.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => setEntries([]),
      },
    ]);
  }, [entries.length]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.title}>Copy History</Text>
            <Text style={styles.subtitle}>
              {isFiltering
                ? `${visible.length} of ${entries.length} ${
                    entries.length === 1 ? 'entry' : 'entries'
                  }`
                : `${entries.length} ${
                    entries.length === 1 ? 'entry' : 'entries'
                  }`}
            </Text>
          </View>
          <Pressable
            onPress={clearAll}
            style={({ pressed }) => [
              styles.clearBtn,
              entries.length === 0 && styles.clearBtnDisabled,
              pressed && styles.clearBtnPressed,
            ]}
            disabled={entries.length === 0}
          >
            <Text style={styles.clearBtnText}>Clear</Text>
          </Pressable>
        </View>
        <View style={styles.searchRow}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search history"
            placeholderTextColor="#999"
            style={styles.searchInput}
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
            returnKeyType="search"
          />
        </View>
      </View>

      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={
          visible.length === 0 ? styles.emptyContainer : styles.listContent
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              {isFiltering ? 'No matches' : 'No copies yet'}
            </Text>
            <Text style={styles.emptyBody}>
              {isFiltering
                ? `Nothing matches "${trimmedQuery}". Clear the search to see all ${entries.length} entries.`
                : 'Copy text in another app, then return here. While this app is open, new copies are captured automatically.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Pressable
              style={({ pressed }) => [
                styles.rowMain,
                pressed && styles.rowPressed,
              ]}
              onPress={() => copyBack(item.text)}
            >
              <Text style={styles.rowText} numberOfLines={4}>
                {item.text}
              </Text>
              <Text style={styles.rowMeta}>
                {formatTime(item.copiedAt)} · tap to copy
              </Text>
            </Pressable>
            <Pressable
              onPress={() => deleteEntry(item.id)}
              style={({ pressed }) => [
                styles.deleteBtn,
                pressed && styles.deleteBtnPressed,
              ]}
              hitSlop={8}
            >
              <Text style={styles.deleteBtnText}>×</Text>
            </Pressable>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  if (sameDay) return `${hh}:${mm}`;
  const mo = (d.getMonth() + 1).toString().padStart(2, '0');
  const dd = d.getDate().toString().padStart(2, '0');
  return `${mo}/${dd} ${hh}:${mm}`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f7',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d0d0d5',
    backgroundColor: '#fff',
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  searchRow: {
    marginTop: 12,
  },
  searchInput: {
    backgroundColor: '#f0f0f4',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 15,
    color: '#111',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111',
  },
  subtitle: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  clearBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#fee',
  },
  clearBtnPressed: {
    backgroundColor: '#fcc',
  },
  clearBtnDisabled: {
    backgroundColor: '#eee',
  },
  clearBtnText: {
    color: '#b00020',
    fontWeight: '600',
    fontSize: 14,
  },
  listContent: {
    padding: 12,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
  },
  rowMain: {
    flex: 1,
    padding: 14,
  },
  rowPressed: {
    backgroundColor: '#f0f0f4',
  },
  rowText: {
    fontSize: 15,
    color: '#111',
    lineHeight: 20,
  },
  rowMeta: {
    fontSize: 12,
    color: '#888',
    marginTop: 6,
  },
  deleteBtn: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: '#e0e0e5',
  },
  deleteBtnPressed: {
    backgroundColor: '#f5f5f7',
  },
  deleteBtnText: {
    fontSize: 22,
    color: '#999',
    lineHeight: 24,
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 32,
  },
  empty: {
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#444',
    marginBottom: 8,
  },
  emptyBody: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    lineHeight: 20,
  },
});
