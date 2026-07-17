import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getPendingItems,
  clearPendingItems,
  setSnippets as setSharedSnippets,
  setRecentEntries as setSharedRecentEntries,
  isKeyboardActive,
} from 'shared-storage';
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
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

const STORAGE_KEY = 'copyhistory:entries:v1';
const SNIPPETS_KEY = 'copyhistory:snippets:v1';
const PASTE_TIP_KEY = 'copyhistory:pasteTipDismissed:v1';
const KBD_TIP_KEY = 'copyhistory:kbdTipDismissed:v1';
const MAX_ENTRIES = 500;
const APP_VERSION = '2.20';
const APP_BUILD = '1';

type SetupKey = 'keyboard' | 'action' | 'widget';

type SetupItem = {
  key: SetupKey;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  detailTitle: string;
  detailDesc: string;
  steps: string[];
  primaryLabel: string;
  primaryAction: 'openSettings' | 'dismiss' | 'openShare';
};

const SETUP_ITEMS: SetupItem[] = [
  {
    key: 'keyboard',
    title: 'Keyboard',
    subtitle: 'Insert snippets & recent copies anywhere',
    icon: 'chatbox-ellipses',
    color: '#3478f6',
    detailTitle: 'Paste with the Keyboard',
    detailDesc:
      'Insert your saved snippets and recent copies while typing in any app — no switching back and forth.',
    steps: [
      'Tap “Open iOS Settings” below',
      'Tap “Keyboards”',
      'Turn on “Snippets Keyboard”',
      'Turn on “Allow Full Access”',
    ],
    primaryLabel: 'Open iOS Settings',
    primaryAction: 'openSettings',
  },
  {
    key: 'action',
    title: 'Share Action',
    subtitle: 'Save text from any app’s Share menu',
    icon: 'share-outline',
    color: '#34c759',
    detailTitle: 'Copy from Any App',
    detailDesc:
      'Save text and links straight into Copy History using the Share menu in any app.',
    steps: [
      'Open the Share menu in any app',
      'Tap “View More” to reveal every action',
      'Tap “Copy History” — a “Saved!” check confirms it',
      'Tip: “Edit Actions” → move it to Favorites so it shows up front and you can skip “View More” next time',
    ],
    primaryLabel: 'Try It — Open Share Sheet',
    primaryAction: 'openShare',
  },
  {
    key: 'widget',
    title: 'Widgets',
    subtitle: 'Snippets & history on your Home Screen',
    icon: 'grid',
    color: '#ff9500',
    detailTitle: 'Speed Up with Widgets',
    detailDesc:
      'Add Copy History widgets to your Home Screen to view and copy your snippets and recent items with one tap.',
    steps: [
      'Touch and hold an empty area of your Home Screen',
      'Tap the “+” in the top-left corner',
      'Search for “Copy History”',
      'Add the Snippets or Recent History widget',
    ],
    primaryLabel: 'Got it',
    primaryAction: 'dismiss',
  },
];

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

type Tab = 'history' | 'snippets' | 'settings';

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<Tab>('history');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [snippetsLoaded, setSnippetsLoaded] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftText, setDraftText] = useState('');
  // Hidden until we know the stored value, so it never flashes for users who
  // already dismissed it. iOS-only — the paste prompt doesn't exist elsewhere.
  const [pasteTipDismissed, setPasteTipDismissed] = useState(true);
  // Same pattern for the keyboard tip: hidden until we know it's needed (the
  // keyboard hasn't been set up with Full Access and the user hasn't dismissed
  // the tip).
  const [kbdTipDismissed, setKbdTipDismissed] = useState(true);
  const [setupDetail, setSetupDetail] = useState<SetupKey | null>(null);
  const entriesRef = useRef<Entry[]>([]);
  const internalCopyRef = useRef<string | null>(null);
  const capturingRef = useRef(false);
  // Tracks the last text we actually upserted, so re-reading unchanged
  // clipboard content on every app foreground doesn't keep re-bumping the
  // same entry's timestamp (and re-triggering a storage write + widget
  // reload) for no reason.
  const lastCapturedTextRef = useRef<string | null>(null);

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
    const recent = sortedEntries
      .slice(0, 10)
      .map(({ id, text, copiedAt }) => ({ id, text, copiedAt }));
    setSharedRecentEntries(JSON.stringify(recent)).catch((e) =>
      console.warn('Failed to mirror history to widget', e),
    );
  }, [entries, loaded, sortedEntries]);

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
    const shared = snippets.map(({ id, label, text }) => ({ id, label, text }));
    setSharedSnippets(JSON.stringify(shared)).catch((e) =>
      console.warn('Failed to mirror snippets to widget', e),
    );
  }, [snippets, snippetsLoaded]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    (async () => {
      try {
        const v = await AsyncStorage.getItem(PASTE_TIP_KEY);
        if (v !== '1') setPasteTipDismissed(false);
      } catch (e) {
        console.warn('Failed to load paste tip state', e);
      }
    })();
  }, []);

  const dismissPasteTip = useCallback(() => {
    setPasteTipDismissed(true);
    AsyncStorage.setItem(PASTE_TIP_KEY, '1').catch(() => {});
  }, []);

  const openPasteSettings = useCallback(() => {
    // Can't toggle "Paste from Other Apps" from code (it's a user privacy
    // control) — deep-link to this app's Settings page so it's one tap away.
    // Deliberately do NOT dismiss the tip here: opening Settings doesn't prove
    // the user flipped the toggle, and iOS gives no way to read it back. The tip
    // stays until the user taps its × (dismissPasteTip).
    Linking.openSettings().catch((e) => console.warn('Failed to open settings', e));
  }, []);

  const openAppSettings = useCallback(() => {
    // Enabling a keyboard / Full Access is a user-only control; deep-link to
    // this app's iOS Settings page so it's as few taps away as possible.
    Linking.openSettings().catch((e) => console.warn('Failed to open settings', e));
  }, []);

  const dismissKbdTip = useCallback(() => {
    setKbdTipDismissed(true);
    AsyncStorage.setItem(KBD_TIP_KEY, '1').catch(() => {});
  }, []);

  // Show the keyboard tip until the keyboard has run with Full Access (marker
  // in the shared container) or the user dismisses it. Re-checked on every
  // foreground so it disappears right after setup.
  const refreshKbdTip = useCallback(async () => {
    if (Platform.OS !== 'ios') return;
    try {
      if (await isKeyboardActive()) {
        setKbdTipDismissed(true);
        AsyncStorage.setItem(KBD_TIP_KEY, '1').catch(() => {});
        return;
      }
      const v = await AsyncStorage.getItem(KBD_TIP_KEY);
      if (v !== '1') setKbdTipDismissed(false);
    } catch (e) {
      console.warn('Failed to refresh keyboard tip', e);
    }
  }, []);

  useEffect(() => {
    refreshKbdTip();
  }, [refreshKbdTip]);

  const captureCurrentClipboard = useCallback(async () => {
    // Coalesce overlapping triggers: returning to the app can fire both the
    // AppState "active" handler and the clipboard-change listener at once.
    // Reading the pasteboard twice would surface two iOS paste prompts for a
    // single copy, so only one read is allowed in flight at a time.
    if (capturingRef.current) return;
    capturingRef.current = true;
    try {
      // hasStringAsync uses UIPasteboard.hasStrings — it does NOT trigger the
      // iOS paste prompt. getStringAsync (below) is the only call that can, so
      // bail out here whenever the pasteboard holds no string at all.
      if (!(await Clipboard.hasStringAsync())) return;
      const text = await Clipboard.getStringAsync();
      // Ignore empty / whitespace-only pasteboards so we never create a blank entry.
      if (!text || !text.trim()) return;
      if (internalCopyRef.current === text) {
        internalCopyRef.current = null;
        return;
      }
      if (lastCapturedTextRef.current === text) return;
      addOrBumpEntry(text);
      // NOTE: the paste tip is intentionally NOT auto-dismissed here. iOS gives
      // no reliable way to know "Paste from Other Apps" is set to Allow (a read
      // can succeed under Allow, under a one-off Ask prompt, or freely on the
      // simulator), so any auto-hide fires too early. The tip stays until the
      // user taps its × (see dismissPasteTip).
    } catch (e) {
      console.warn('Failed to read clipboard', e);
    } finally {
      capturingRef.current = false;
    }
  }, []);

  // Upserts by text: if this text is already in history, bump it to the top
  // (update copiedAt in place) instead of adding a duplicate entry.
  const addOrBumpEntry = useCallback((text: string) => {
    lastCapturedTextRef.current = text;
    setEntries((prev) => {
      const existingIndex = prev.findIndex((e) => e.text === text);
      if (existingIndex !== -1) {
        return prev.map((e, i) =>
          i === existingIndex ? { ...e, copiedAt: Date.now() } : e,
        );
      }
      const next: Entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text,
        copiedAt: Date.now(),
      };
      const all = [next, ...prev];
      const pinned = all.filter((e) => e.pinned);
      const unpinned = all.filter((e) => !e.pinned);
      const maxUnpinned = Math.max(0, MAX_ENTRIES - pinned.length);
      return [...unpinned.slice(0, maxUnpinned), ...pinned];
    });
  }, []);

  const drainSharedItems = useCallback(async () => {
    try {
      // Pull anything the share extension / keyboard queued into the shared
      // App Group file and fold it into history (deduped, newest first).
      const items = await getPendingItems();
      if (items.length === 0) return;
      await clearPendingItems();
      const existing = entriesRef.current;
      const seenTexts = new Set(existing.map((e) => e.text));
      const newEntries: Entry[] = [];
      const now = Date.now();
      items.forEach((text, i) => {
        if (!text || seenTexts.has(text)) return;
        seenTexts.add(text);
        newEntries.push({
          id: `${now + i}-${Math.random().toString(36).slice(2, 8)}`,
          text,
          copiedAt: now - (items.length - i) * 100,
        });
      });
      if (newEntries.length === 0) return;
      setEntries((prev) => {
        const all = [...newEntries, ...prev];
        const pinned = all.filter((e) => e.pinned);
        const unpinned = all.filter((e) => !e.pinned);
        const maxUnpinned = Math.max(0, MAX_ENTRIES - pinned.length);
        return [...unpinned.slice(0, maxUnpinned), ...pinned];
      });
    } catch (e) {
      console.warn('Failed to drain shared items', e);
    }
  }, []);

  useEffect(() => {
    if (!loaded) return;
    captureCurrentClipboard();
    drainSharedItems();
    // expo-clipboard's web shim doesn't implement addClipboardListener.
    // Guard so the app can still run via expo-web for screenshots / preview.
    if (Platform.OS === 'web' || typeof Clipboard.addClipboardListener !== 'function') {
      return;
    }
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
      if (state === 'active') {
        captureCurrentClipboard();
        drainSharedItems();
        refreshKbdTip();
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [loaded, captureCurrentClipboard, drainSharedItems, refreshKbdTip]);

  const copyBack = useCallback(async (text: string) => {
    internalCopyRef.current = text;
    await Clipboard.setStringAsync(text);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, []);

  // Re-copying a history entry bumps it to the top instead of leaving a
  // stale duplicate sitting in its old spot.
  const recopyEntry = useCallback(
    (text: string) => {
      copyBack(text);
      addOrBumpEntry(text);
    },
    [copyBack, addOrBumpEntry],
  );

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
    // If the still-on-the-pasteboard text is what's being deleted, forget we
    // "already captured" it — otherwise it can never be re-added until
    // something else is copied first.
    const deleted = entriesRef.current.find((e) => e.id === id);
    if (deleted && lastCapturedTextRef.current === deleted.text) {
      lastCapturedTextRef.current = null;
    }
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
            setSnippets((prev) => prev.filter((s) => s.id !== snippet.id)),
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
        onPress: () => {
          lastCapturedTextRef.current = null;
          setEntries([]);
        },
      },
    ]);
  }, [entries.length]);

  const clearAllSnippets = useCallback(() => {
    if (snippets.length === 0) return;
    Alert.alert('Clear snippets?', `Delete all ${snippets.length} snippets.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => setSnippets([]),
      },
    ]);
  }, [snippets.length]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style="dark" />

      {activeTab === 'history' && (
        <View style={styles.tabScreen}>
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

          {Platform.OS === 'ios' && !pasteTipDismissed && (
            <Pressable
              onPress={openPasteSettings}
              style={({ pressed }) => [styles.tip, pressed && styles.tipPressed]}
            >
              <View style={styles.tipTextWrap}>
                <Text style={styles.tipTitle}>Skip the paste prompt ›</Text>
                <Text style={styles.tipBody} numberOfLines={2}>
                  Allow “Paste from Other Apps” so copies save silently.
                </Text>
              </View>
              <Pressable
                onPress={dismissPasteTip}
                hitSlop={12}
                style={({ pressed }) => [
                  styles.tipClose,
                  pressed && styles.tipClosePressed,
                ]}
              >
                <Text style={styles.tipCloseText}>×</Text>
              </Pressable>
            </Pressable>
          )}

          {Platform.OS === 'ios' && !kbdTipDismissed && (
            <Pressable
              onPress={() => setSetupDetail('keyboard')}
              style={({ pressed }) => [styles.tip, pressed && styles.tipPressed]}
            >
              <View style={styles.tipTextWrap}>
                <Text style={styles.tipTitle}>Try the keyboard ›</Text>
                <Text style={styles.tipBody} numberOfLines={2}>
                  Insert snippets & recent copies while typing in any app.
                </Text>
              </View>
              <Pressable
                onPress={dismissKbdTip}
                hitSlop={12}
                style={({ pressed }) => [
                  styles.tipClose,
                  pressed && styles.tipClosePressed,
                ]}
              >
                <Text style={styles.tipCloseText}>×</Text>
              </Pressable>
            </Pressable>
          )}

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
                    onPress={() => recopyEntry(item.text)}
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
        </View>
      )}

      {activeTab === 'snippets' && (
        <View style={styles.tabScreen}>
          <View style={styles.header}>
            <View style={styles.headerTop}>
              <View>
                <Text style={styles.title}>Snippets</Text>
                <Text style={styles.subtitle}>
                  {snippets.length} {snippets.length === 1 ? 'snippet' : 'snippets'}
                </Text>
              </View>
              <Pressable
                onPress={openAddSnippet}
                style={({ pressed }) => [
                  styles.newSnippetBtn,
                  pressed && styles.newSnippetBtnPressed,
                ]}
              >
                <Text style={styles.newSnippetBtnText}>+ New Snippet</Text>
              </Pressable>
            </View>
            <Text style={styles.snippetsInstruction}>
              Save text you use often — like an email, phone number, or
              address — then tap any snippet below to copy it instantly.
            </Text>
          </View>

          <FlatList
            data={snippets}
            keyExtractor={(item) => item.id}
            contentContainerStyle={
              snippets.length === 0 ? styles.emptyContainer : styles.listContent
            }
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No snippets yet</Text>
                <Text style={styles.emptyBody}>
                  Tap “New Snippet” to save text you reuse often, like an
                  email address or phone number.
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
                  <Text style={styles.snippetLabel} numberOfLines={1}>
                    {item.label}
                  </Text>
                  <Text style={styles.snippetPreview} numberOfLines={2}>
                    {item.text}
                  </Text>
                  <Text style={styles.rowMeta}>tap to copy</Text>
                </Pressable>
                <Pressable
                  onPress={() => openEditSnippet(item)}
                  style={({ pressed }) => [
                    styles.snippetEditBtn,
                    pressed && styles.snippetEditBtnPressed,
                  ]}
                  hitSlop={8}
                >
                  <Text style={styles.snippetEditBtnText}>Edit</Text>
                </Pressable>
                <Pressable
                  onPress={() => deleteSnippet(item)}
                  style={({ pressed }) => [
                    styles.deleteBtn,
                    pressed && styles.deleteBtnPressed,
                  ]}
                  hitSlop={8}
                >
                  <Ionicons name="trash-outline" size={18} color="#b00020" />
                </Pressable>
              </View>
            )}
          />
        </View>
      )}

      {activeTab === 'settings' && (
        <View style={styles.tabScreen}>
          <View style={styles.header}>
            <Text style={styles.title}>Settings</Text>
          </View>
          <ScrollView contentContainerStyle={styles.settingsContent}>
            <Text style={styles.settingsSectionTitle}>Set Up Copy History</Text>
            <View style={styles.settingsCard}>
              {SETUP_ITEMS.map((item, i) => (
                <View key={item.key}>
                  {i > 0 && <View style={styles.setupDivider} />}
                  <Pressable
                    onPress={() => setSetupDetail(item.key)}
                    style={({ pressed }) => [
                      styles.setupRow,
                      pressed && styles.setupRowPressed,
                    ]}
                  >
                    <View
                      style={[styles.setupIcon, { backgroundColor: item.color }]}
                    >
                      <Ionicons name={item.icon} size={20} color="#fff" />
                    </View>
                    <View style={styles.setupRowText}>
                      <Text style={styles.setupRowTitle}>{item.title}</Text>
                      <Text style={styles.setupRowSub}>{item.subtitle}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#c4c4cc" />
                  </Pressable>
                </View>
              ))}
            </View>

            {Platform.OS === 'ios' && (
              <>
                <Text style={styles.settingsSectionTitle}>Clipboard</Text>
                <View style={styles.settingsCard}>
                  <Pressable
                    onPress={openAppSettings}
                    style={({ pressed }) => [
                      styles.settingsRow,
                      pressed && styles.setupRowPressed,
                    ]}
                  >
                    <View style={styles.settingsRowTextWrap}>
                      <Text style={styles.settingsRowLabel}>
                        Allow Paste from Other Apps
                      </Text>
                      <Text style={styles.settingsRowHint}>
                        Skip the paste prompt so copies save silently.
                      </Text>
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color="#c4c4cc"
                    />
                  </Pressable>
                </View>
              </>
            )}

            <Text style={styles.settingsSectionTitle}>Data</Text>
            <View style={styles.settingsCard}>
              <View style={styles.settingsRow}>
                <Text style={styles.settingsRowLabel}>History entries</Text>
                <Text style={styles.settingsRowValue}>{entries.length}</Text>
              </View>
              <View style={styles.settingsDivider} />
              <View style={styles.settingsRow}>
                <Text style={styles.settingsRowLabel}>Saved snippets</Text>
                <Text style={styles.settingsRowValue}>{snippets.length}</Text>
              </View>
              <View style={styles.settingsDivider} />
              <View style={styles.settingsRow}>
                <Text style={styles.settingsRowLabel}>Version</Text>
                <Text style={styles.settingsRowValue}>
                  {APP_VERSION} ({APP_BUILD})
                </Text>
              </View>
            </View>

            <Pressable
              onPress={clearAll}
              disabled={entries.length === 0}
              style={({ pressed }) => [
                styles.settingsDestructiveBtn,
                entries.length === 0 && styles.settingsDestructiveBtnDisabled,
                pressed && styles.settingsDestructiveBtnPressed,
              ]}
            >
              <Text
                style={[
                  styles.settingsDestructiveBtnText,
                  entries.length === 0 && styles.settingsDestructiveBtnTextDisabled,
                ]}
              >
                Clear All History
              </Text>
            </Pressable>
            <Pressable
              onPress={clearAllSnippets}
              disabled={snippets.length === 0}
              style={({ pressed }) => [
                styles.settingsDestructiveBtn,
                snippets.length === 0 && styles.settingsDestructiveBtnDisabled,
                pressed && styles.settingsDestructiveBtnPressed,
              ]}
            >
              <Text
                style={[
                  styles.settingsDestructiveBtnText,
                  snippets.length === 0 && styles.settingsDestructiveBtnTextDisabled,
                ]}
              >
                Clear All Snippets
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      )}

      <View style={[styles.tabBar, { paddingBottom: insets.bottom + 8 }]}>
        <TabButton
          label="History"
          icon="time-outline"
          activeIcon="time"
          active={activeTab === 'history'}
          onPress={() => setActiveTab('history')}
        />
        <TabButton
          label="Snippets"
          icon="chatbox-outline"
          activeIcon="chatbox"
          active={activeTab === 'snippets'}
          onPress={() => setActiveTab('snippets')}
        />
        <TabButton
          label="Settings"
          icon="settings-outline"
          activeIcon="settings"
          active={activeTab === 'settings'}
          onPress={() => setActiveTab('settings')}
        />
      </View>

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
                {editingId ? 'Edit Snippet' : 'New Snippet'}
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

      <Modal
        visible={setupDetail !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSetupDetail(null)}
      >
        {setupDetail && (
          <SetupDetailScreen
            item={SETUP_ITEMS.find((s) => s.key === setupDetail)!}
            onClose={() => setSetupDetail(null)}
            onPrimary={() => {
              const action = SETUP_ITEMS.find((s) => s.key === setupDetail)!
                .primaryAction;
              setSetupDetail(null);
              if (action === 'openSettings') openAppSettings();
              else if (action === 'openShare') {
                // Let the detail modal finish dismissing first, then present the
                // system Share sheet on some sample text so the user can try
                // tapping "Copy History" right away.
                setTimeout(() => {
                  Share.share({
                    message:
                      'Copy History — tap “Copy History” in this Share sheet to save this text to your clipboard history.',
                  }).catch((e) => console.warn('Failed to open share sheet', e));
                }, 350);
              }
            }}
          />
        )}
      </Modal>
    </SafeAreaView>
  );
}

function SetupDetailScreen({
  item,
  onClose,
  onPrimary,
}: {
  item: SetupItem;
  onClose: () => void;
  onPrimary: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.detailScreen}>
      <View style={styles.detailTopBar}>
        <Pressable
          onPress={onClose}
          hitSlop={10}
          style={({ pressed }) => [
            styles.detailClose,
            pressed && styles.detailClosePressed,
          ]}
        >
          <Ionicons name="close" size={22} color="#666" />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.detailContent}>
        <SetupMockup itemKey={item.key} color={item.color} />
        <Text style={styles.detailTitle}>{item.detailTitle}</Text>
        <Text style={styles.detailDesc}>{item.detailDesc}</Text>

        <View style={styles.detailStepsCard}>
          {item.steps.map((step, i) => (
            <View key={i} style={styles.detailStepRow}>
              <View style={[styles.detailStepNum, { backgroundColor: item.color }]}>
                <Text style={styles.detailStepNumText}>{i + 1}</Text>
              </View>
              <Text style={styles.detailStepText}>{step}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={[styles.detailFooter, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          onPress={onPrimary}
          style={({ pressed }) => [
            styles.detailPrimaryBtn,
            pressed && styles.detailPrimaryBtnPressed,
          ]}
        >
          <Text style={styles.detailPrimaryBtnText}>{item.primaryLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// Themed, illustrative mock of each extension (no photographic assets) so the
// detail screen has a clear visual without shipping screenshots.
function SetupMockup({ itemKey, color }: { itemKey: SetupKey; color: string }) {
  if (itemKey === 'keyboard') {
    return (
      <View style={styles.mockKeyboard}>
        <View style={styles.mockKbPillRow}>
          <View style={[styles.mockKbPill, { backgroundColor: color, width: 62 }]} />
          <View style={[styles.mockKbPill, { backgroundColor: color, width: 44 }]} />
          <View style={[styles.mockKbPillGray, { width: 80 }]} />
          <View style={[styles.mockKbPillGray, { width: 54 }]} />
        </View>
        <View style={styles.mockKbKeyRow}>
          {['.', ',', '?', '!', "'"].map((k) => (
            <View key={k} style={styles.mockKbKey}>
              <Text style={styles.mockKbKeyText}>{k}</Text>
            </View>
          ))}
          <View style={[styles.mockKbKey, styles.mockKbSpace]}>
            <Text style={styles.mockKbKeyText}>space</Text>
          </View>
          <View style={[styles.mockKbKey, { backgroundColor: color }]}>
            <Ionicons name="return-down-back" size={16} color="#fff" />
          </View>
        </View>
      </View>
    );
  }
  if (itemKey === 'action') {
    return (
      <View style={styles.mockSheet}>
        {[
          { icon: 'copy-outline', label: 'Copy', on: false },
          { icon: 'folder-outline', label: 'Save to Files', on: false },
          { icon: 'time', label: 'Copy History', on: true },
        ].map((r, i) => (
          <View
            key={i}
            style={[styles.mockSheetRow, r.on && { backgroundColor: '#eaf1ff' }]}
          >
            <Ionicons
              name={r.icon as keyof typeof Ionicons.glyphMap}
              size={20}
              color={r.on ? color : '#8a8a92'}
            />
            <Text style={[styles.mockSheetLabel, r.on && { color, fontWeight: '700' }]}>
              {r.label}
            </Text>
            {r.on && <Ionicons name="checkmark-circle" size={18} color={color} />}
          </View>
        ))}
      </View>
    );
  }
  // widget
  return (
    <View style={styles.mockHome}>
      <View style={styles.mockWidget}>
        <Text style={styles.mockWidgetTitle}>SNIPPETS</Text>
        <View style={[styles.mockWidgetLine, { width: '70%' }]} />
        <View style={[styles.mockWidgetLine, { width: '52%' }]} />
        <View style={[styles.mockWidgetLine, { width: '60%' }]} />
      </View>
      <View style={styles.mockWidget}>
        <Text style={styles.mockWidgetTitle}>HISTORY</Text>
        <View style={[styles.mockWidgetLine, { width: '80%' }]} />
        <View style={[styles.mockWidgetLine, { width: '45%' }]} />
        <View style={[styles.mockWidgetLine, { width: '66%' }]} />
      </View>
    </View>
  );
}

function TabButton({
  label,
  icon,
  activeIcon,
  active,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tabBtn, pressed && styles.tabBtnPressed]}
      hitSlop={4}
    >
      <Ionicons
        name={active ? activeIcon : icon}
        size={22}
        color={active ? '#3478f6' : '#9a9aa2'}
      />
      <Text style={[styles.tabBtnText, active && styles.tabBtnTextActive]}>
        {label}
      </Text>
    </Pressable>
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
  tabScreen: {
    flex: 1,
  },
  tip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#eef3ff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d7e2ff',
  },
  tipPressed: {
    backgroundColor: '#e3ecff',
  },
  tipTextWrap: {
    flex: 1,
    paddingRight: 8,
  },
  tipTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1b2a4a',
  },
  tipBody: {
    fontSize: 12,
    lineHeight: 16,
    color: '#475574',
    marginTop: 2,
  },
  tipClose: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  tipClosePressed: {
    opacity: 0.5,
  },
  tipCloseText: {
    fontSize: 20,
    lineHeight: 22,
    color: '#8a93a8',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d0d0d5',
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
  newSnippetBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: '#111',
  },
  newSnippetBtnPressed: {
    backgroundColor: '#333',
  },
  newSnippetBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  snippetsInstruction: {
    fontSize: 13,
    lineHeight: 18,
    color: '#666',
    marginTop: 10,
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
    marginTop: 6,
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
  snippetLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111',
  },
  snippetPreview: {
    fontSize: 13,
    color: '#555',
    lineHeight: 18,
    marginTop: 4,
  },
  snippetEditBtn: {
    width: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: '#e0e0e5',
  },
  snippetEditBtnPressed: {
    backgroundColor: '#f5f5f7',
  },
  snippetEditBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3478f6',
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
  settingsContent: {
    padding: 16,
  },
  settingsSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8a8a92',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 4,
  },
  settingsCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 20,
  },
  keyboardInfo: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 4,
  },
  keyboardInfoTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111',
  },
  keyboardInfoBody: {
    fontSize: 13,
    lineHeight: 18,
    color: '#666',
    marginTop: 4,
  },
  keyboardSteps: {
    fontSize: 13,
    lineHeight: 20,
    color: '#444',
    marginTop: 10,
  },
  keyboardBtn: {
    margin: 14,
    marginTop: 10,
    backgroundColor: '#3478f6',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  keyboardBtnPressed: {
    backgroundColor: '#2a64d8',
  },
  keyboardBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  setupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  setupRowPressed: {
    backgroundColor: '#f0f0f4',
  },
  setupDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#e0e0e5',
    marginLeft: 62,
  },
  setupIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  setupRowText: {
    flex: 1,
  },
  setupRowTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111',
  },
  setupRowSub: {
    fontSize: 12,
    color: '#888',
    marginTop: 1,
  },
  settingsRowTextWrap: {
    flex: 1,
    paddingRight: 12,
  },
  settingsRowHint: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
    lineHeight: 16,
  },
  detailScreen: {
    flex: 1,
    backgroundColor: '#f5f5f7',
  },
  detailTopBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  detailClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#e6e6ea',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailClosePressed: {
    opacity: 0.6,
  },
  detailContent: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    alignItems: 'center',
  },
  detailTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#111',
    textAlign: 'center',
    marginTop: 24,
  },
  detailDesc: {
    fontSize: 15,
    lineHeight: 21,
    color: '#666',
    textAlign: 'center',
    marginTop: 10,
  },
  detailStepsCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    alignSelf: 'stretch',
    padding: 6,
    marginTop: 24,
  },
  detailStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  detailStepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  detailStepNumText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  detailStepText: {
    flex: 1,
    fontSize: 15,
    color: '#222',
    lineHeight: 20,
  },
  detailFooter: {
    paddingHorizontal: 24,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e0e0e5',
    backgroundColor: '#f5f5f7',
  },
  detailPrimaryBtn: {
    backgroundColor: '#3478f6',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  detailPrimaryBtnPressed: {
    backgroundColor: '#2a64d8',
  },
  detailPrimaryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  mockKeyboard: {
    alignSelf: 'stretch',
    backgroundColor: '#d9dde3',
    borderRadius: 14,
    padding: 12,
    marginTop: 8,
  },
  mockKbPillRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 10,
  },
  mockKbPill: {
    height: 30,
    borderRadius: 15,
  },
  mockKbPillGray: {
    height: 30,
    borderRadius: 15,
    backgroundColor: '#b9bec6',
  },
  mockKbKeyRow: {
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
  },
  mockKbKey: {
    minWidth: 26,
    height: 34,
    borderRadius: 6,
    backgroundColor: '#fbfbfd',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  mockKbSpace: {
    flex: 1,
  },
  mockKbKeyText: {
    fontSize: 13,
    color: '#333',
    fontWeight: '500',
  },
  mockSheet: {
    alignSelf: 'stretch',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 8,
    marginTop: 8,
  },
  mockSheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  mockSheetLabel: {
    flex: 1,
    fontSize: 15,
    color: '#333',
  },
  mockHome: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 8,
  },
  mockWidget: {
    width: 120,
    height: 120,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  mockWidgetTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#8a8a92',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  mockWidgetLine: {
    height: 9,
    borderRadius: 4,
    backgroundColor: '#dfe3ea',
    marginBottom: 7,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  settingsRowLabel: {
    fontSize: 15,
    color: '#111',
  },
  settingsRowValue: {
    fontSize: 15,
    color: '#666',
  },
  settingsDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#e0e0e5',
    marginLeft: 14,
  },
  settingsDestructiveBtn: {
    backgroundColor: '#fee',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  settingsDestructiveBtnPressed: {
    backgroundColor: '#fcc',
  },
  settingsDestructiveBtnDisabled: {
    backgroundColor: '#eee',
  },
  settingsDestructiveBtnText: {
    color: '#b00020',
    fontWeight: '600',
    fontSize: 15,
  },
  settingsDestructiveBtnTextDisabled: {
    color: '#bbb',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#d0d0d5',
    paddingTop: 8,
    paddingBottom: 8,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  tabBtnPressed: {
    opacity: 0.6,
  },
  tabBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9a9aa2',
    marginTop: 2,
  },
  tabBtnTextActive: {
    color: '#3478f6',
  },
});
