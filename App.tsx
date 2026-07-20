import { StatusBar } from 'expo-status-bar';
import {
  LANG_OPTIONS,
  Lang,
  LangPref,
  getLang,
  isRTLLang,
  resolveLang,
  setLang,
  t,
  tCount,
} from './i18n';
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
  Appearance,
  AppState,
  AppStateStatus,
  DynamicColorIOS,
  I18nManager,
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

// Dark mode. Every colour in this file goes through dyn(), so iOS swaps the
// palette itself when the system appearance changes — no re-render, no theme
// context, and the static StyleSheet below keeps working untouched.
// Cast to string so existing `color: string` props (Ionicons, placeholders)
// keep type-checking; at runtime RN accepts the dynamic colour object.
const dyn = (light: string, dark: string) =>
  DynamicColorIOS({ light, dark }) as unknown as string;

const STORAGE_KEY = 'copyhistory:entries:v1';
const SNIPPETS_KEY = 'copyhistory:snippets:v1';
const PASTE_TIP_KEY = 'copyhistory:pasteTipDismissed:v1';
const KBD_TIP_KEY = 'copyhistory:kbdTipDismissed:v1';
const THEME_KEY = 'copyhistory:theme:v1';
const LANG_KEY = 'copyhistory:lang:v1';
const MAX_ENTRIES = 500;
const APP_VERSION = '2.23';
const APP_BUILD = '1';

type ThemePref = 'system' | 'light' | 'dark';

const THEME_OPTIONS: { key: ThemePref; label: string; icon: string }[] = [
  { key: 'system', label: 'System', icon: 'phone-portrait-outline' },
  { key: 'light', label: 'Light', icon: 'sunny-outline' },
  { key: 'dark', label: 'Dark', icon: 'moon-outline' },
];

// Appearance.setColorScheme drives the window's overrideUserInterfaceStyle, and
// every colour here is a DynamicColorIOS pair — so one call re-themes the whole
// app without any re-render plumbing. null hands control back to iOS.
function applyTheme(pref: ThemePref) {
  Appearance.setColorScheme(pref === 'system' ? null : pref);
}

// Point the dictionary at the chosen language and line up the layout direction
// for the next launch (RTL can only be applied at startup).
function applyLang(lang: Lang) {
  setLang(lang);
  const rtl = isRTLLang(lang);
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
}

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

// Built per-render (not a module constant) so the strings follow the active
// language rather than being frozen at import time.
const getSetupItems = (): SetupItem[] => [
  {
    key: 'keyboard',
    title: t('setupKeyboardShort'),
    subtitle: t('setupKeyboardSub'),
    icon: 'chatbox-ellipses',
    color: dyn('#3478f6', '#4a90ff'),
    detailTitle: t('setupKeyboardTitle'),
    detailDesc: t('setupKeyboardDesc'),
    steps: [t('kbStep1'), t('kbStep2'), t('kbStep3'), t('kbStep4')],
    primaryLabel: t('openIosSettings'),
    primaryAction: 'openSettings',
  },
  {
    key: 'action',
    title: t('setupActionShort'),
    subtitle: t('setupActionSub'),
    icon: 'share-outline',
    color: dyn('#34c759', '#32d74b'),
    detailTitle: t('setupActionDetailTitle'),
    detailDesc: t('setupActionDesc'),
    steps: [t('acStep1'), t('acStep2'), t('acStep3'), t('acStep4')],
    primaryLabel: t('setupActionPrimary'),
    primaryAction: 'openShare',
  },
  {
    key: 'widget',
    title: t('setupWidgetShort'),
    subtitle: t('setupWidgetSub'),
    icon: 'grid',
    color: dyn('#ff9500', '#ff9f0a'),
    detailTitle: t('setupWidgetDetailTitle'),
    detailDesc: t('setupWidgetDesc'),
    steps: [t('wgStep1'), t('wgStep2'), t('wgStep3'), t('wgStep4')],
    primaryLabel: t('gotIt'),
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
  const [theme, setTheme] = useState<ThemePref>('system');
  const [langPref, setLangPref] = useState<LangPref>('system');
  // Bumped whenever the language changes so the tree re-renders with new copy.
  const [langTick, setLangTick] = useState(0);
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

  // Restore the saved theme before first paint so the app never flashes the
  // wrong appearance on launch.
  useEffect(() => {
    (async () => {
      try {
        const v = (await AsyncStorage.getItem(THEME_KEY)) as ThemePref | null;
        if (v === 'light' || v === 'dark' || v === 'system') {
          setTheme(v);
          applyTheme(v);
        }
      } catch (e) {
        console.warn('Failed to load theme', e);
      }
    })();
  }, []);

  // Restore the saved language (or follow the device) before first paint.
  useEffect(() => {
    (async () => {
      try {
        const v = (await AsyncStorage.getItem(LANG_KEY)) as LangPref | null;
        const pref: LangPref =
          v === 'en' || v === 'ar' || v === 'system' ? v : 'system';
        setLangPref(pref);
        applyLang(resolveLang(pref));
        setLangTick((n) => n + 1);
      } catch (e) {
        console.warn('Failed to load language', e);
      }
    })();
  }, []);

  const chooseLang = useCallback(
    (pref: LangPref) => {
      const next = resolveLang(pref);
      const wasRTL = I18nManager.isRTL;
      setLangPref(pref);
      applyLang(next);
      setLangTick((n) => n + 1);
      Haptics.selectionAsync().catch(() => {});
      AsyncStorage.setItem(LANG_KEY, pref).catch((e) =>
        console.warn('Failed to save language', e),
      );
      // forceRTL only takes effect on a fresh launch, so when the direction
      // actually flips we have to tell the user rather than silently leaving
      // the layout half-switched.
      if (isRTLLang(next) !== wasRTL) {
        Alert.alert(t('restartRequiredTitle'), t('restartRequiredBody'), [
          { text: t('gotIt') },
        ]);
      }
    },
    [],
  );

  const setupItems = useMemo(() => getSetupItems(), [langTick]);

  const chooseTheme = useCallback((pref: ThemePref) => {
    setTheme(pref);
    applyTheme(pref);
    Haptics.selectionAsync().catch(() => {});
    AsyncStorage.setItem(THEME_KEY, pref).catch((e) =>
      console.warn('Failed to save theme', e),
    );
  }, []);

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
      t('deleteSnippetTitle'),
      `"${snippet.label}" will be removed.`,
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('delete'),
          style: 'destructive',
          onPress: () =>
            setSnippets((prev) => prev.filter((s) => s.id !== snippet.id)),
        },
      ],
    );
  }, []);

  const clearAll = useCallback(() => {
    if (entries.length === 0) return;
    Alert.alert(t('clearHistoryTitle'), t('clearHistoryBody'), [
      { text: t('cancel'), style: 'cancel' },
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
    Alert.alert(t('clearSnippetsTitle'), `Delete all ${snippets.length} snippets.`, [
      { text: t('cancel'), style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => setSnippets([]),
      },
    ]);
  }, [snippets.length]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style="auto" />

      {activeTab === 'history' && (
        <View style={styles.tabScreen}>
          <View style={styles.header}>
            <View style={styles.headerTop}>
              <View>
                <Text style={styles.title}>{t('appName')}</Text>
                <Text style={styles.subtitle}>
                  {isFiltering
                    ? t('filteredCount', {
                        shown: visible.length,
                        total: entries.length,
                      })
                    : tCount('entryCount', entries.length)}
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
                <Text style={styles.clearBtnText}>{t('clear')}</Text>
              </Pressable>
            </View>
            <View style={styles.searchRow}>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t('searchHistory')}
                placeholderTextColor={dyn('#999', '#8e8e93')}
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
                <Text style={styles.tipTitle}>{t('tipPasteTitle')}</Text>
                <Text style={styles.tipBody} numberOfLines={2}>
                  {t('tipPasteBody')}
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
                <Text style={styles.tipTitle}>{t('tipKeyboardTitle')}</Text>
                <Text style={styles.tipBody} numberOfLines={2}>
                  {t('tipKeyboardBody')}
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
                <Text style={styles.title}>{t('snippets')}</Text>
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
                <Text style={styles.emptyTitle}>{t('noSnippetsYet')}</Text>
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
                  <Text style={styles.snippetEditBtnText}>{t('edit')}</Text>
                </Pressable>
                <Pressable
                  onPress={() => deleteSnippet(item)}
                  style={({ pressed }) => [
                    styles.deleteBtn,
                    pressed && styles.deleteBtnPressed,
                  ]}
                  hitSlop={8}
                >
                  <Ionicons name="trash-outline" size={18} color={dyn('#b00020', '#ff6b6b')} />
                </Pressable>
              </View>
            )}
          />
        </View>
      )}

      {activeTab === 'settings' && (
        <View style={styles.tabScreen}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('settings')}</Text>
          </View>
          <ScrollView contentContainerStyle={styles.settingsContent}>
            <Text style={styles.settingsSectionTitle}>{t('setUpCopyHistory')}</Text>
            <View style={styles.settingsCard}>
              {setupItems.map((item, i) => (
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
                    <Ionicons name="chevron-forward" size={18} color={dyn('#c4c4cc', '#5a5a5e')} />
                  </Pressable>
                </View>
              ))}
            </View>

            <Text style={styles.settingsSectionTitle}>{t('appearance')}</Text>
            <View style={styles.settingsCard}>
              <View style={styles.themeRow}>
                {THEME_OPTIONS.map((opt) => {
                  const active = theme === opt.key;
                  return (
                    <Pressable
                      key={opt.key}
                      onPress={() => chooseTheme(opt.key)}
                      style={({ pressed }) => [
                        styles.themeOption,
                        active && styles.themeOptionActive,
                        pressed && styles.setupRowPressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`${opt.label} appearance`}
                    >
                      <Ionicons
                        name={opt.icon as any}
                        size={20}
                        color={active ? '#fff' : dyn('#8a8a92', '#8e8e93')}
                      />
                      <Text
                        style={[
                          styles.themeOptionText,
                          active && styles.themeOptionTextActive,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Text style={styles.settingsSectionTitle}>{t('language')}</Text>
            <View style={styles.settingsCard}>
              <View style={styles.themeRow}>
                {LANG_OPTIONS.map((opt) => {
                  const active = langPref === opt.key;
                  return (
                    <Pressable
                      key={opt.key}
                      onPress={() => chooseLang(opt.key)}
                      style={({ pressed }) => [
                        styles.themeOption,
                        active && styles.themeOptionActive,
                        pressed && styles.setupRowPressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text
                        style={[
                          styles.themeOptionText,
                          active && styles.themeOptionTextActive,
                        ]}
                      >
                        {opt.key === 'system' ? t('themeSystem') : opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {Platform.OS === 'ios' && (
              <>
                <Text style={styles.settingsSectionTitle}>{t('clipboard')}</Text>
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
                        {t('allowPasteTitle')}
                      </Text>
                      <Text style={styles.settingsRowHint}>
                        {t('allowPasteHint')}
                      </Text>
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={dyn('#c4c4cc', '#5a5a5e')}
                    />
                  </Pressable>
                </View>
              </>
            )}

            <Text style={styles.settingsSectionTitle}>{t('data')}</Text>
            <View style={styles.settingsCard}>
              <View style={styles.settingsRow}>
                <Text style={styles.settingsRowLabel}>{t('historyEntries')}</Text>
                <Text style={styles.settingsRowValue}>{entries.length}</Text>
              </View>
              <View style={styles.settingsDivider} />
              <View style={styles.settingsRow}>
                <Text style={styles.settingsRowLabel}>{t('savedSnippets')}</Text>
                <Text style={styles.settingsRowValue}>{snippets.length}</Text>
              </View>
              <View style={styles.settingsDivider} />
              <View style={styles.settingsRow}>
                <Text style={styles.settingsRowLabel}>{t('version')}</Text>
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
          label={t('history')}
          icon="time-outline"
          activeIcon="time"
          active={activeTab === 'history'}
          onPress={() => setActiveTab('history')}
        />
        <TabButton
          label={t('snippets')}
          icon="chatbox-outline"
          activeIcon="chatbox"
          active={activeTab === 'snippets'}
          onPress={() => setActiveTab('snippets')}
        />
        <TabButton
          label={t('settings')}
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
                placeholder={t('labelPlaceholder')}
                placeholderTextColor={dyn('#999', '#8e8e93')}
                style={styles.modalInput}
                autoFocus
                maxLength={40}
              />
              <TextInput
                value={draftText}
                onChangeText={setDraftText}
                placeholder={t('textPlaceholder')}
                placeholderTextColor={dyn('#999', '#8e8e93')}
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
                  <Text style={styles.modalBtnText}>{t('cancel')}</Text>
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
                    {t('save')}
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
            item={setupItems.find((s) => s.key === setupDetail)!}
            onClose={() => setSetupDetail(null)}
            onPrimary={() => {
              const action = setupItems.find((s) => s.key === setupDetail)!
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
          <Ionicons name="close" size={22} color={dyn('#666', '#aeaeb2')} />
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
            style={[styles.mockSheetRow, r.on && { backgroundColor: dyn('#eaf1ff', '#16233d') }]}
          >
            <Ionicons
              name={r.icon as keyof typeof Ionicons.glyphMap}
              size={20}
              color={r.on ? color : dyn('#8a8a92', '#8e8e93')}
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
        <Text style={styles.mockWidgetTitle}>{t('snippets').toUpperCase()}</Text>
        <View style={[styles.mockWidgetLine, { width: '70%' }]} />
        <View style={[styles.mockWidgetLine, { width: '52%' }]} />
        <View style={[styles.mockWidgetLine, { width: '60%' }]} />
      </View>
      <View style={styles.mockWidget}>
        <Text style={styles.mockWidgetTitle}>{t('history').toUpperCase()}</Text>
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
        color={active ? dyn('#3478f6', '#4a90ff') : dyn('#9a9aa2', '#8e8e93')}
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
    backgroundColor: dyn('#f5f5f7', '#101014'),
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
    backgroundColor: dyn('#eef3ff', '#16233d'),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: dyn('#d7e2ff', '#274063'),
  },
  tipPressed: {
    backgroundColor: dyn('#e3ecff', '#1d2c4a'),
  },
  tipTextWrap: {
    flex: 1,
    paddingRight: 8,
  },
  tipTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: dyn('#1b2a4a', '#dce7ff'),
  },
  tipBody: {
    fontSize: 12,
    lineHeight: 16,
    color: dyn('#475574', '#a9bde0'),
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
    color: dyn('#8a93a8', '#8e9bb5'),
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: dyn('#fff', '#1c1c1e'),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: dyn('#d0d0d5', '#48484a'),
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
    backgroundColor: dyn('#f0f0f4', '#2c2c2e'),
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 15,
    color: dyn('#111', '#f2f2f7'),
  },
  newSnippetBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: dyn('#111', '#f2f2f7'),
  },
  newSnippetBtnPressed: {
    backgroundColor: dyn('#333', '#e5e5ea'),
  },
  newSnippetBtnText: {
    color: dyn('#fff', '#1c1c1e'),
    fontWeight: '600',
    fontSize: 14,
  },
  snippetsInstruction: {
    fontSize: 13,
    lineHeight: 18,
    color: dyn('#666', '#aeaeb2'),
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
    backgroundColor: dyn('#fff', '#1c1c1e'),
    borderRadius: 16,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: dyn('#111', '#f2f2f7'),
    marginBottom: 4,
  },
  modalHint: {
    fontSize: 13,
    color: dyn('#777', '#aeaeb2'),
    marginBottom: 14,
  },
  modalInput: {
    backgroundColor: dyn('#f0f0f4', '#2c2c2e'),
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: dyn('#111', '#f2f2f7'),
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
    backgroundColor: dyn('#f0f0f4', '#2c2c2e'),
  },
  modalBtnPressed: {
    backgroundColor: dyn('#e2e2ea', '#3a3a3c'),
  },
  modalBtnPrimary: {
    backgroundColor: dyn('#111', '#f2f2f7'),
  },
  modalBtnPrimaryPressed: {
    backgroundColor: dyn('#333', '#e5e5ea'),
  },
  modalBtnDisabled: {
    backgroundColor: dyn('#bbb', '#6a6a6e'),
  },
  modalBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: dyn('#333', '#e5e5ea'),
  },
  modalBtnTextPrimary: {
    color: dyn('#fff', '#1c1c1e'),
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: dyn('#111', '#f2f2f7'),
  },
  subtitle: {
    fontSize: 13,
    color: dyn('#666', '#aeaeb2'),
    marginTop: 2,
  },
  clearBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: dyn('#fee', '#3a1a1c'),
  },
  clearBtnPressed: {
    backgroundColor: dyn('#fcc', '#5a2427'),
  },
  clearBtnDisabled: {
    backgroundColor: dyn('#eee', '#2c2c2e'),
  },
  clearBtnText: {
    color: dyn('#b00020', '#ff6b6b'),
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
    backgroundColor: dyn('#fff', '#1c1c1e'),
    borderRadius: 12,
    overflow: 'hidden',
  },
  rowMain: {
    flex: 1,
    padding: 14,
  },
  rowPressed: {
    backgroundColor: dyn('#f0f0f4', '#2c2c2e'),
  },
  rowText: {
    fontSize: 15,
    color: dyn('#111', '#f2f2f7'),
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
    color: dyn('#888', '#9a9aa0'),
    flexShrink: 1,
    marginTop: 6,
  },
  actionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: dyn('#e8f0fe', '#16233d'),
  },
  actionBtnPressed: {
    backgroundColor: dyn('#cfdcf7', '#274063'),
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: dyn('#1a56d8', '#5a9dff'),
  },
  snippetLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: dyn('#111', '#f2f2f7'),
  },
  snippetPreview: {
    fontSize: 13,
    color: dyn('#555', '#c7c7cc'),
    lineHeight: 18,
    marginTop: 4,
  },
  snippetEditBtn: {
    width: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: dyn('#e0e0e5', '#38383a'),
  },
  snippetEditBtnPressed: {
    backgroundColor: dyn('#f5f5f7', '#101014'),
  },
  snippetEditBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: dyn('#3478f6', '#4a90ff'),
  },
  pinBtn: {
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: dyn('#e0e0e5', '#38383a'),
  },
  pinBtnPressed: {
    backgroundColor: dyn('#f5f5f7', '#101014'),
  },
  pinBtnText: {
    fontSize: 18,
    color: dyn('#bbb', '#6a6a6e'),
    lineHeight: 20,
  },
  pinBtnTextActive: {
    color: dyn('#f5a623', '#ffb340'),
  },
  deleteBtn: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: dyn('#e0e0e5', '#38383a'),
  },
  deleteBtnPressed: {
    backgroundColor: dyn('#f5f5f7', '#101014'),
  },
  deleteBtnText: {
    fontSize: 22,
    color: dyn('#999', '#8e8e93'),
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
    color: dyn('#444', '#d1d1d6'),
    marginBottom: 8,
  },
  emptyBody: {
    fontSize: 14,
    color: dyn('#888', '#9a9aa0'),
    textAlign: 'center',
    lineHeight: 20,
  },
  settingsContent: {
    padding: 16,
  },
  themeRow: {
    flexDirection: 'row',
    padding: 8,
    gap: 8,
  },
  themeOption: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: dyn('#f0f0f4', '#2c2c2e'),
    gap: 4,
  },
  themeOptionActive: {
    backgroundColor: dyn('#3478f6', '#4a90ff'),
  },
  themeOptionText: {
    fontSize: 13,
    fontWeight: '600',
    color: dyn('#8a8a92', '#8e8e93'),
  },
  themeOptionTextActive: {
    color: '#fff',
  },
  settingsSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: dyn('#8a8a92', '#8e8e93'),
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 4,
  },
  settingsCard: {
    backgroundColor: dyn('#fff', '#1c1c1e'),
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
    color: dyn('#111', '#f2f2f7'),
  },
  keyboardInfoBody: {
    fontSize: 13,
    lineHeight: 18,
    color: dyn('#666', '#aeaeb2'),
    marginTop: 4,
  },
  keyboardSteps: {
    fontSize: 13,
    lineHeight: 20,
    color: dyn('#444', '#d1d1d6'),
    marginTop: 10,
  },
  keyboardBtn: {
    margin: 14,
    marginTop: 10,
    backgroundColor: dyn('#3478f6', '#4a90ff'),
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  keyboardBtnPressed: {
    backgroundColor: dyn('#2a64d8', '#4a90ff'),
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
    backgroundColor: dyn('#f0f0f4', '#2c2c2e'),
  },
  setupDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: dyn('#e0e0e5', '#38383a'),
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
    color: dyn('#111', '#f2f2f7'),
  },
  setupRowSub: {
    fontSize: 12,
    color: dyn('#888', '#9a9aa0'),
    marginTop: 1,
  },
  settingsRowTextWrap: {
    flex: 1,
    paddingRight: 12,
  },
  settingsRowHint: {
    fontSize: 12,
    color: dyn('#888', '#9a9aa0'),
    marginTop: 2,
    lineHeight: 16,
  },
  detailScreen: {
    flex: 1,
    backgroundColor: dyn('#f5f5f7', '#101014'),
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
    backgroundColor: dyn('#e6e6ea', '#2c2c2e'),
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
    color: dyn('#111', '#f2f2f7'),
    textAlign: 'center',
    marginTop: 24,
  },
  detailDesc: {
    fontSize: 15,
    lineHeight: 21,
    color: dyn('#666', '#aeaeb2'),
    textAlign: 'center',
    marginTop: 10,
  },
  detailStepsCard: {
    backgroundColor: dyn('#fff', '#1c1c1e'),
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
    color: dyn('#222', '#e5e5ea'),
    lineHeight: 20,
  },
  detailFooter: {
    paddingHorizontal: 24,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: dyn('#e0e0e5', '#38383a'),
    backgroundColor: dyn('#f5f5f7', '#101014'),
  },
  detailPrimaryBtn: {
    backgroundColor: dyn('#3478f6', '#4a90ff'),
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  detailPrimaryBtnPressed: {
    backgroundColor: dyn('#2a64d8', '#4a90ff'),
  },
  detailPrimaryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  mockKeyboard: {
    alignSelf: 'stretch',
    backgroundColor: dyn('#d9dde3', '#3a3a3c'),
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
    backgroundColor: dyn('#b9bec6', '#6a6a6e'),
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
    backgroundColor: dyn('#fbfbfd', '#1c1c1e'),
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  mockKbSpace: {
    flex: 1,
  },
  mockKbKeyText: {
    fontSize: 13,
    color: dyn('#333', '#e5e5ea'),
    fontWeight: '500',
  },
  mockSheet: {
    alignSelf: 'stretch',
    backgroundColor: dyn('#fff', '#1c1c1e'),
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
    color: dyn('#333', '#e5e5ea'),
  },
  mockHome: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 8,
  },
  mockWidget: {
    width: 120,
    height: 120,
    backgroundColor: dyn('#fff', '#1c1c1e'),
    borderRadius: 20,
    padding: 12,
    shadowColor: dyn('#000', '#ffffff'),
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  mockWidgetTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: dyn('#8a8a92', '#8e8e93'),
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  mockWidgetLine: {
    height: 9,
    borderRadius: 4,
    backgroundColor: dyn('#dfe3ea', '#3a3a3c'),
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
    color: dyn('#111', '#f2f2f7'),
  },
  settingsRowValue: {
    fontSize: 15,
    color: dyn('#666', '#aeaeb2'),
  },
  settingsDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: dyn('#e0e0e5', '#38383a'),
    marginLeft: 14,
  },
  settingsDestructiveBtn: {
    backgroundColor: dyn('#fee', '#3a1a1c'),
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  settingsDestructiveBtnPressed: {
    backgroundColor: dyn('#fcc', '#5a2427'),
  },
  settingsDestructiveBtnDisabled: {
    backgroundColor: dyn('#eee', '#2c2c2e'),
  },
  settingsDestructiveBtnText: {
    color: dyn('#b00020', '#ff6b6b'),
    fontWeight: '600',
    fontSize: 15,
  },
  settingsDestructiveBtnTextDisabled: {
    color: dyn('#bbb', '#6a6a6e'),
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: dyn('#fff', '#1c1c1e'),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: dyn('#d0d0d5', '#48484a'),
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
    color: dyn('#9a9aa2', '#8e8e93'),
    marginTop: 2,
  },
  tabBtnTextActive: {
    color: dyn('#3478f6', '#4a90ff'),
  },
});
