# Arabic App Store screenshots. Run with:  python3 compose_ar.py
RTL = True                              # shape + mirror text for Arabic

APP_NAME    = "سجل النسخ"
TAGLINE     = "احفظ وأعد استخدام كل نسخة"
TITLE_SIZE  = 118
ICON        = "../assets/icon.png"

RAW_DIR     = "raw-ar"
OUT_DIR     = "../app-store-screenshots-ar"

BG_STOPS      = [(47, 107, 255), (29, 78, 216), (21, 65, 176)]
ACCENT        = (52, 199, 89)
HEADLINE_BOLD = None
SUBTITLE      = (219, 230, 255)
WATERMARK     = (255, 255, 255)

HERO_SHOT = "history.png"
HERO_SW   = 1125
HERO_TILT = -20
HERO_SPILL = 120
HERO_PX   = 1050
BULLETS = [
    "كل نسخة تُحفظ تلقائيًا",
    "لوحة مفاتيح للمقتطفات والنسخ",
    "احفظ من قائمة المشاركة في أي تطبيق",
    "خصوصية تامة — لا شيء يغادر جهازك",
]

PANEL_SW = 1150

PANELS = [
    ("snippets", "المقتطفات التي تكررها",  "snippets.png", "low",  "العناوين والردود والرموز — محفوظة"),
    ("settings", "بالعربية وبالوضع الداكن", "settings.png", "high", "اختر اللغة والمظهر كما تحب"),
    ("dark",     "مريح للعين ليلًا",        "dark.png",     "low",  "يتبع نظامك أو اختر يدويًا"),
]
