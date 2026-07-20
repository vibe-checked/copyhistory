import { getLocales } from 'expo-localization';

// Supported UI languages. Anything else falls back to English.
export type Lang = 'en' | 'ar';
export type LangPref = 'system' | Lang;

export const RTL_LANGS: Lang[] = ['ar'];

export const LANG_OPTIONS: { key: LangPref; label: string }[] = [
  { key: 'system', label: 'System' },
  { key: 'en', label: 'English' },
  { key: 'ar', label: 'العربية' },
];

const en = {
  // Tabs / titles
  history: 'History',
  snippets: 'Snippets',
  settings: 'Settings',
  appName: 'Copy History',

  // History screen
  entryCount_one: '{{count}} entry',
  entryCount_other: '{{count}} entries',
  searchHistory: 'Search history',
  clear: 'Clear',
  noCopiesYet: 'No copies yet',
  noCopiesHint:
    'Copy text in another app, then return here. While this app is open, new copies are captured automatically.',
  noMatches: 'No matches',
  tapToCopy: 'tap to copy',
  copied: 'Copied',
  pinned: 'Pinned',
  open: 'Open',
  resultCount_one: '{{count}} result',
  resultCount_other: '{{count}} results',
  filteredCount: '{{shown}} of {{total}}',

  // Tips
  tipPasteTitle: 'Skip the paste prompt',
  tipPasteBody: 'Allow “Paste from Other Apps” so copies save silently.',
  tipKeyboardTitle: 'Try the keyboard',
  tipKeyboardBody: 'Insert snippets & recent copies while typing in any app.',

  // Snippets
  newSnippet: 'New Snippet',
  editSnippet: 'Edit Snippet',
  noSnippetsYet: 'No snippets yet',
  noSnippetsHint: 'Save text you paste often — addresses, replies, codes.',
  label: 'Label',
  text: 'Text',
  save: 'Save',
  cancel: 'Cancel',
  delete: 'Delete',
  edit: 'Edit',
  searchSnippets: 'Search snippets',
  labelPlaceholder: 'Label (e.g. Email)',
  textPlaceholder: 'Text to copy',

  // Alerts
  clearHistoryTitle: 'Clear history?',
  clearHistoryBody: 'This removes every saved copy. This cannot be undone.',
  clearAllHistory: 'Clear All History',
  clearSnippetsTitle: 'Clear snippets?',
  clearSnippetsBody: 'This removes every saved snippet. This cannot be undone.',
  clearAllSnippets: 'Clear All Snippets',
  deleteSnippetTitle: 'Delete snippet?',

  // Settings
  setUpCopyHistory: 'Set Up Copy History',
  appearance: 'Appearance',
  themeSystem: 'System',
  themeLight: 'Light',
  themeDark: 'Dark',
  language: 'Language',
  clipboard: 'Clipboard',
  allowPasteTitle: 'Allow Paste from Other Apps',
  allowPasteHint: 'Skip the paste prompt so copies save silently.',
  data: 'Data',
  historyEntries: 'History entries',
  savedSnippets: 'Saved snippets',
  version: 'Version',
  openIosSettings: 'Open iOS Settings',
  gotIt: 'Got it',
  restartRequiredTitle: 'Restart required',
  restartRequiredBody:
    'Close and reopen Copy History to finish switching the layout direction.',

  // Setup rows
  setupKeyboardTitle: 'Paste with the Keyboard',
  setupKeyboardDesc:
    'Insert your saved snippets and recent copies while typing in any app — no switching back and forth.',
  setupActionTitle: 'Save text from any app’s Share menu',
  setupActionDesc:
    'Save text and links straight into Copy History using the Share menu in any app.',
  setupWidgetTitle: 'Add the Snippets or Recent History widget',
  setupWidgetDesc:
    'Add Copy History widgets to your Home Screen to view and copy your snippets and recent items with one tap.',
  // Setup rows — short
  setupKeyboardShort: 'Keyboard',
  setupKeyboardSub: 'Insert snippets & recent copies anywhere',
  setupActionShort: 'Share Action',
  setupActionSub: 'Save text from any app’s Share menu',
  setupWidgetShort: 'Widgets',
  setupWidgetSub: 'Snippets & history on your Home Screen',
  setupActionDetailTitle: 'Copy from Any App',
  setupWidgetDetailTitle: 'Speed Up with Widgets',
  setupActionPrimary: 'Try It — Open Share Sheet',
  // Steps
  kbStep1: 'Tap “Open iOS Settings” below',
  kbStep2: 'Tap “Keyboards”',
  kbStep3: 'Turn on “Snippets Keyboard”',
  kbStep4: 'Turn on “Allow Full Access”',
  acStep1: 'Open the Share menu in any app',
  acStep2: 'Tap “View More” to reveal every action',
  acStep3: 'Tap “Copy History” — a “Saved!” check confirms it',
  acStep4: 'Tip: “Edit Actions” → move it to Favorites so it shows up front and you can skip “View More” next time',
  wgStep1: 'Touch and hold an empty area of your Home Screen',
  wgStep2: 'Tap the “+” in the top-left corner',
  wgStep3: 'Search for “Copy History”',
  wgStep4: 'Add the Snippets or Recent History widget',
};

// Arabic (Modern Standard). Keep placeholders like {{count}} intact.
const ar: typeof en = {
  history: 'السجل',
  snippets: 'المقتطفات',
  settings: 'الإعدادات',
  appName: 'سجل النسخ',

  entryCount_one: 'عنصر واحد',
  entryCount_other: '{{count}} عنصرًا',
  searchHistory: 'ابحث في السجل',
  clear: 'مسح',
  noCopiesYet: 'لا توجد نسخ بعد',
  noCopiesHint:
    'انسخ نصًا في تطبيق آخر ثم عد إلى هنا. أثناء فتح التطبيق يتم حفظ النسخ الجديدة تلقائيًا.',
  noMatches: 'لا توجد نتائج',
  tapToCopy: 'اضغط للنسخ',
  copied: 'تم النسخ',
  pinned: 'مثبت',
  open: 'فتح',
  resultCount_one: 'نتيجة واحدة',
  resultCount_other: '{{count}} نتيجة',
  filteredCount: '{{shown}} من {{total}}',

  tipPasteTitle: 'تخطَّ رسالة اللصق',
  tipPasteBody: 'اسمح بـ «اللصق من التطبيقات الأخرى» ليتم الحفظ بصمت.',
  tipKeyboardTitle: 'جرّب لوحة المفاتيح',
  tipKeyboardBody: 'أدرج المقتطفات والنسخ الأخيرة أثناء الكتابة في أي تطبيق.',

  newSnippet: 'مقتطف جديد',
  editSnippet: 'تعديل المقتطف',
  noSnippetsYet: 'لا توجد مقتطفات بعد',
  noSnippetsHint: 'احفظ النصوص التي تلصقها كثيرًا — العناوين والردود والرموز.',
  label: 'الاسم',
  text: 'النص',
  save: 'حفظ',
  cancel: 'إلغاء',
  delete: 'حذف',
  edit: 'تعديل',
  searchSnippets: 'ابحث في المقتطفات',
  labelPlaceholder: 'الاسم (مثل: البريد)',
  textPlaceholder: 'النص المراد نسخه',

  clearHistoryTitle: 'مسح السجل؟',
  clearHistoryBody: 'سيؤدي هذا إلى حذف كل النسخ المحفوظة. لا يمكن التراجع.',
  clearAllHistory: 'مسح كل السجل',
  clearSnippetsTitle: 'مسح المقتطفات؟',
  clearSnippetsBody: 'سيؤدي هذا إلى حذف كل المقتطفات المحفوظة. لا يمكن التراجع.',
  clearAllSnippets: 'مسح كل المقتطفات',
  deleteSnippetTitle: 'حذف المقتطف؟',

  setUpCopyHistory: 'إعداد سجل النسخ',
  appearance: 'المظهر',
  themeSystem: 'النظام',
  themeLight: 'فاتح',
  themeDark: 'داكن',
  language: 'اللغة',
  clipboard: 'الحافظة',
  allowPasteTitle: 'السماح باللصق من التطبيقات الأخرى',
  allowPasteHint: 'تخطَّ رسالة اللصق ليتم حفظ النسخ بصمت.',
  data: 'البيانات',
  historyEntries: 'عناصر السجل',
  savedSnippets: 'المقتطفات المحفوظة',
  version: 'الإصدار',
  openIosSettings: 'فتح إعدادات iOS',
  gotIt: 'حسنًا',
  restartRequiredTitle: 'يلزم إعادة التشغيل',
  restartRequiredBody: 'أغلق التطبيق وأعد فتحه لإكمال تغيير اتجاه الواجهة.',

  setupKeyboardTitle: 'اللصق بلوحة المفاتيح',
  setupKeyboardDesc:
    'أدرج مقتطفاتك المحفوظة ونسخك الأخيرة أثناء الكتابة في أي تطبيق — دون التنقل بين التطبيقات.',
  setupActionTitle: 'احفظ النص من قائمة المشاركة في أي تطبيق',
  setupActionDesc:
    'احفظ النصوص والروابط مباشرة في سجل النسخ عبر قائمة المشاركة في أي تطبيق.',
  setupWidgetTitle: 'أضف أداة المقتطفات أو السجل الأخير',
  setupWidgetDesc:
    'أضف أدوات سجل النسخ إلى الشاشة الرئيسية لعرض ونسخ مقتطفاتك وعناصرك الأخيرة بضغطة واحدة.',
  setupKeyboardShort: 'لوحة المفاتيح',
  setupKeyboardSub: 'أدرج المقتطفات والنسخ الأخيرة في أي مكان',
  setupActionShort: 'إجراء المشاركة',
  setupActionSub: 'احفظ النص من قائمة المشاركة في أي تطبيق',
  setupWidgetShort: 'الأدوات',
  setupWidgetSub: 'المقتطفات والسجل على شاشتك الرئيسية',
  setupActionDetailTitle: 'انسخ من أي تطبيق',
  setupWidgetDetailTitle: 'أسرع مع الأدوات',
  setupActionPrimary: 'جرّبه — افتح قائمة المشاركة',
  kbStep1: 'اضغط «فتح إعدادات iOS» بالأسفل',
  kbStep2: 'اضغط «لوحات المفاتيح»',
  kbStep3: 'فعّل «Snippets Keyboard»',
  kbStep4: 'فعّل «السماح بالوصول الكامل»',
  acStep1: 'افتح قائمة المشاركة في أي تطبيق',
  acStep2: 'اضغط «عرض المزيد» لإظهار كل الإجراءات',
  acStep3: 'اضغط «سجل النسخ» — ستؤكد علامة «تم الحفظ!»',
  acStep4: 'نصيحة: «تعديل الإجراءات» ← انقله إلى المفضلة ليظهر مباشرة وتتخطى «عرض المزيد» لاحقًا',
  wgStep1: 'اضغط مطولًا على مساحة فارغة في الشاشة الرئيسية',
  wgStep2: 'اضغط «+» في الزاوية العلوية',
  wgStep3: 'ابحث عن «Copy History»',
  wgStep4: 'أضف أداة المقتطفات أو السجل الأخير',
};

const DICTS: Record<Lang, typeof en> = { en, ar };
export type TKey = keyof typeof en;

// Resolve the device's language, falling back to English for anything we don't
// ship translations for.
export function deviceLang(): Lang {
  try {
    const tag = getLocales()[0]?.languageCode ?? 'en';
    return (DICTS as Record<string, unknown>)[tag] ? (tag as Lang) : 'en';
  } catch {
    return 'en';
  }
}

export function resolveLang(pref: LangPref): Lang {
  return pref === 'system' ? deviceLang() : pref;
}

export function isRTLLang(lang: Lang) {
  return RTL_LANGS.includes(lang);
}

let current: Lang = 'en';
export function setLang(lang: Lang) {
  current = lang;
}
export function getLang(): Lang {
  return current;
}

// Translate. Falls back to English, then to the key itself, so a missing
// translation degrades to readable text instead of blowing up.
export function t(key: TKey, vars?: Record<string, string | number>): string {
  const dict = DICTS[current] ?? en;
  let s: string = (dict[key] as string) ?? (en[key] as string) ?? String(key);
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`{{${k}}}`, 'g'), String(v));
    }
  }
  return s;
}

// Simple plural helper — Arabic has richer plural rules, but for the small
// counts shown here one/other is accurate enough and reads naturally.
export function tCount(base: 'entryCount' | 'resultCount', count: number) {
  const key = (count === 1 ? `${base}_one` : `${base}_other`) as TKey;
  return t(key, { count });
}
