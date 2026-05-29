import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  AppStateStatus,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const STORAGE_KEY = 'copyhistory:entries:v1';
const SNIPPETS_KEY = 'copyhistory:snippets:v1';
const MAX_ENTRIES = 500;

type Entry = {
  id: string;
  text: string;
  copiedAt: number;
  pinned?: boolean;
};

type SmartAction =
  | { kind: 'url'; url: string }
  | { kind: 'email'; url: string }
  | { kind: 'tel'; url: string }
  | null;

function detectAction(raw: string): SmartAction {
  const text = raw.trim();
  if (!text || text.length > 2000) return null;
  if (/^https?:\/\/\S+$/i.test(text)) return { kind: 'url', url: text };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
    return { kind: 'email', url: `mailto:${text}` };
  }
  if (/^\+?[\d][\d\s().\-]{6,}$/.test(text)) {
    return { kind: 'tel', url: `tel:${text.replace(/[^\d+]/g, '')}` };
  }
  return null;
}

type Snippet = {
  id: string;
  label: string;
  text: string;
  createdAt: number;
};

export default function App() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [snippetsLoaded, setSnippetsLoaded] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftText, setDraftText] = useState('');
  const [editMode, setEditMode] = useState(false);
  const entriesRef = useRef<Entry[]>([]);
  const internalCopyRef = useRef<string | null>(null);

  const trimmedQuery = query.trim();
  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return b.copiedAt - a.copiedAt;
    });
  }, [entries]);
  const visible = trimmedQuery
    ? sortedEntries.filter((e) =>
        e.text.toLowerCase().includes(trimmedQuery.toLowerCase()),
      )
    : sortedEntries;
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

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(SNIPPETS_KEY);
        if (raw) setSnippets(JSON.parse(raw));
      } catch (e) {
        console.warn('Failed to load snippets', e);
      } finally {
        setSnippetsLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!snippetsLoaded) return;
    AsyncStorage.setItem(SNIPPETS_KEY, JSON.stringify(snippets)).catch((e) =>
      console.warn('Failed to persist snippets', e),
    );
  }, [snippets, snippetsLoaded]);

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
      const newestUnpinned = current.find((e) => !e.pinned);
      if (newestUnpinned?.text === text) return;
      const next: Entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text,
        copiedAt: Date.now(),
      };
      setEntries((prev) => {
        const all = [next, ...prev];
        const pinned = all.filter((e) => e.pinned);
        const unpinned = all.filter((e) => !e.pinned);
        const maxUnpinned = Math.max(0, MAX_ENTRIES - pinned.length);
        return [...unpinned.slice(0, maxUnpinned), ...pinned];
      });
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, []);

  const togglePin = useCallback((id: string) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, pinned: !e.pinned } : e)),
    );
    Haptics.selectionAsync().catch(() => {});
  }, []);

  const openSmartAction = useCallback(async (action: SmartAction) => {
    if (!action) return;
    try {
      await Linking.openURL(action.url);
    } catch (e) {
      console.warn('Failed to open URL', e);
    }
  }, []);

  const deleteEntry = useCallback((id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const openAddSnippet = useCallback(() => {
    setEditingId(null);
    setDraftLabel('');
    setDraftText('');
    setAddOpen(true);
  }, []);

  const openEditSnippet = useCallback((snippet: Snippet) => {
    setEditingId(snippet.id);
    setDraftLabel(snippet.label);
    setDraftText(snippet.text);
    setAddOpen(true);
  }, []);

  const saveSnippet = useCallback(() => {
    const label = draftLabel.trim();
    const text = draftText;
    if (!label || !text) return;
    if (editingId) {
      setSnippets((prev) =>
        prev.map((s) => (s.id === editingId ? { ...s, label, text } : s)),
      );
    } else {
      const next: Snippet = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label,
        text,
        createdAt: Date.now(),
      };
      setSnippets((prev) => [next, ...prev]);
    }
    setDraftLabel('');
    setDraftText('');
    setEditingId(null);
    setAddOpen(false);
  }, [draftLabel, draftText, editingId]);

  const cancelSnippet = useCallback(() => {
    setDraftLabel('');
    setDraftText('');
    setEditingId(null);
    setAddOpen(false);
  }, []);

  const deleteSnippet = useCallback((snippet: Snippet) => {
    Alert.alert(
      'Delete snippet?',
      `"${snippet.label}" will be removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            setSnippets((prev) => {
              const next = prev.filter((s) => s.id !== snippet.id);
              if (next.length === 0) setEditMode(false);
              return next;
            }),
        },
      ],
    );
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
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.snippetsContent}
          style={styles.snippetsScroll}
        >
          <Pressable
            onPress={openAddSnippet}
            style={({ pressed }) => [
              styles.addChip,
              pressed && styles.addChipPressed,
            ]}
          >
            <Text style={styles.addChipText}>+ Saved</Text>
          </Pressable>
          {snippets.length > 0 && (
            <Pressable
              onPress={() => setEditMode((v) => !v)}
              style={({ pressed }) => [
                styles.editChip,
                editMode && styles.editChipActive,
                pressed && styles.editChipPressed,
              ]}
            >
              <Text
                style={[
                  styles.editChipText,
                  editMode && styles.editChipTextActive,
                ]}
              >
                {editMode ? 'Done' : 'Edit'}
              </Text>
            </Pressable>
          )}
          {snippets.map((s) => (
            <Pressable
              key={s.id}
              onPress={() =>
                editMode ? openEditSnippet(s) : copyBack(s.text)
              }
              style={({ pressed }) => [
                styles.chip,
                editMode && styles.chipEditing,
                pressed && (editMode ? styles.chipEditingPressed : styles.chipPressed),
              ]}
            >
              <Text
                style={[styles.chipText, editMode && styles.chipTextEditing]}
                numberOfLines={1}
              >
                {s.label}
              </Text>
              {editMode && (
                <Pressable
                  onPress={() => deleteSnippet(s)}
                  hitSlop={10}
                  style={({ pressed }) => [
                    styles.chipDelete,
                    pressed && styles.chipDeletePressed,
                  ]}
                >
                  <Text style={styles.chipDeleteText}>×</Text>
                </Pressable>
              )}
            </Pressable>
          ))}
        </ScrollView>
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
        renderItem={({ item }) => {
          const action = detectAction(item.text);
          return (
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
                <View style={styles.rowFooter}>
                  <Text style={styles.rowMeta}>
                    {item.pinned ? '★ ' : ''}
                    {formatTime(item.copiedAt)} · tap to copy
                  </Text>
                  {action && (
                    <Pressable
                      onPress={() => openSmartAction(action)}
                      style={({ pressed }) => [
                        styles.actionBtn,
                        pressed && styles.actionBtnPressed,
                      ]}
                      hitSlop={6}
                    >
                      <Text style={styles.actionBtnText}>
                        {action.kind === 'url'
                          ? 'Open'
                          : action.kind === 'email'
                            ? 'Mail'
                            : 'Call'}
                      </Text>
                    </Pressable>
                  )}
                </View>
              </Pressable>
              <Pressable
                onPress={() => togglePin(item.id)}
                style={({ pressed }) => [
                  styles.pinBtn,
                  pressed && styles.pinBtnPressed,
                ]}
                hitSlop={8}
              >
                <Text
                  style={[
                    styles.pinBtnText,
                    item.pinned && styles.pinBtnTextActive,
                  ]}
                >
                  {item.pinned ? '★' : '☆'}
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
          );
        }}
      />

      <Modal
        visible={addOpen}
        transparent
        animationType="fade"
        onRequestClose={cancelSnippet}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <Pressable style={styles.modalBackdropTouch} onPress={cancelSnippet}>
            <Pressable style={styles.modalCard} onPress={() => {}}>
              <Text style={styles.modalTitle}>
                {editingId ? 'Edit snippet' : 'New snippet'}
              </Text>
              <Text style={styles.modalHint}>
                Save text you copy often — email, phone, address, anything.
              </Text>
              <TextInput
                value={draftLabel}
                onChangeText={setDraftLabel}
                placeholder="Label (e.g. Email)"
                placeholderTextColor="#999"
                style={styles.modalInput}
                autoFocus
                maxLength={40}
              />
              <TextInput
                value={draftText}
                onChangeText={setDraftText}
                placeholder="Text to copy"
                placeholderTextColor="#999"
                style={[styles.modalInput, styles.modalTextarea]}
                multiline
                textAlignVertical="top"
              />
              <View style={styles.modalActions}>
                <Pressable
                  onPress={cancelSnippet}
                  style={({ pressed }) => [
                    styles.modalBtn,
                    pressed && styles.modalBtnPressed,
                  ]}
                >
                  <Text style={styles.modalBtnText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={saveSnippet}
                  disabled={!draftLabel.trim() || !draftText}
                  style={({ pressed }) => [
                    styles.modalBtn,
                    styles.modalBtnPrimary,
                    (!draftLabel.trim() || !draftText) && styles.modalBtnDisabled,
                    pressed && styles.modalBtnPrimaryPressed,
                  ]}
                >
                  <Text
                    style={[styles.modalBtnText, styles.modalBtnTextPrimary]}
                  >
                    Save
                  </Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
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
  snippetsScroll: {
    marginTop: 10,
    marginHorizontal: -20,
  },
  snippetsContent: {
    paddingHorizontal: 20,
    gap: 8,
  },
  addChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#b8b8c0',
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
    justifyContent: 'center',
  },
  addChipPressed: {
    backgroundColor: '#eaeaef',
  },
  addChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#555',
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#111',
    maxWidth: 180,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chipPressed: {
    backgroundColor: '#333',
  },
  chipEditing: {
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#b8b8c0',
    paddingRight: 4,
  },
  chipEditingPressed: {
    backgroundColor: '#eaeaef',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  chipTextEditing: {
    color: '#111',
  },
  chipDelete: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#b00020',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  chipDeletePressed: {
    backgroundColor: '#8a0019',
  },
  chipDeleteText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 18,
    marginTop: -2,
  },
  editChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#3478f6',
    backgroundColor: 'transparent',
    justifyContent: 'center',
  },
  editChipActive: {
    backgroundColor: '#3478f6',
  },
  editChipPressed: {
    backgroundColor: '#dde7fa',
  },
  editChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3478f6',
  },
  editChipTextActive: {
    color: '#fff',
  },
  modalBackdrop: {
    flex: 1,
  },
  modalBackdropTouch: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111',
    marginBottom: 4,
  },
  modalHint: {
    fontSize: 13,
    color: '#777',
    marginBottom: 14,
  },
  modalInput: {
    backgroundColor: '#f0f0f4',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111',
    marginBottom: 10,
  },
  modalTextarea: {
    minHeight: 96,
    paddingTop: 10,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
  },
  modalBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#f0f0f4',
  },
  modalBtnPressed: {
    backgroundColor: '#e2e2ea',
  },
  modalBtnPrimary: {
    backgroundColor: '#111',
  },
  modalBtnPrimaryPressed: {
    backgroundColor: '#333',
  },
  modalBtnDisabled: {
    backgroundColor: '#bbb',
  },
  modalBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  modalBtnTextPrimary: {
    color: '#fff',
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
  rowFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    gap: 8,
  },
  rowMeta: {
    fontSize: 12,
    color: '#888',
    flexShrink: 1,
  },
  actionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#e8f0fe',
  },
  actionBtnPressed: {
    backgroundColor: '#cfdcf7',
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1a56d8',
  },
  pinBtn: {
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: '#e0e0e5',
  },
  pinBtnPressed: {
    backgroundColor: '#f5f5f7',
  },
  pinBtnText: {
    fontSize: 18,
    color: '#bbb',
    lineHeight: 20,
  },
  pinBtnTextActive: {
    color: '#f5a623',
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
