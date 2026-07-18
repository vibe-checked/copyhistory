# Per-app settings for the App Store screenshot kit. Edit this file only.
# Run from this folder:  python3 compose.py

APP_NAME    = "Copy History"
TAGLINE     = "Save & reuse every copy"
TITLE_SIZE  = 118                       # shrink if the name is long (e.g. 96)
ICON        = "../assets/icon.png"      # path to the 1024px app icon (relative to this folder)

RAW_DIR     = "raw"                     # where your raw simulator screenshots live
OUT_DIR     = "../app-store-screenshots"  # final 01..0N land here (upload to App Store Connect)

# Brand — sampled from the app icon's blue.
BG_STOPS      = [(47, 107, 255), (29, 78, 216), (21, 65, 176)]  # gradient top->bottom
ACCENT        = (52, 199, 89)           # bullet check-mark color (iOS green)
HEADLINE_BOLD = None                    # None = white *bold* keywords; or an (r,g,b) to tint them
SUBTITLE      = (219, 230, 255)         # panel subtitle color
WATERMARK     = (255, 255, 255)         # faint background swirl color

# Hero (screens 1+2)
HERO_SHOT = "history.png"               # which raw to feature in the spanning hero phone
HERO_SW   = 1125                        # hero phone width   | HERO_TILT angle | HERO_PX seam x
HERO_TILT = -20                         # -20 = top-left corner highest (leans right)
HERO_SPILL = 120                        # px of the phone's right edge to spill onto screen 03
HERO_PX   = 1050                        # (ignored when HERO_SPILL > 0)
BULLETS = [                             # 4 value props (hero, left of phone)
    "Every copy saved automatically",
    "A keyboard for snippets & copies",
    "Save from any app's Share menu",
    "Private — nothing leaves your device",
]

PANEL_SW = 1150                         # feature-panel phone width

# Feature panels (screens 3+). One tuple each:
#   (label, headline, raw_filename, "low"|"high", subtitle)
#   *asterisks* emphasize a word; "low" = headline top, "high" = headline bottom
PANELS = [
    ("keyboard", "A *keyboard* for your copies",  "keyboard.png", "low",  "Insert snippets & recent copies anywhere"),
    ("share",    "Save from *any* *app*",          "share.png",    "high", "Copies save automatically — or use Share"),
    ("widgets",  "Right on your *Home* *Screen*",  "widgets.png",  "low",  "Snippets & history, one tap away"),
    ("snippets", "*Snippets* you reuse most",      "snippets.png", "high", "Addresses, replies, codes — saved"),
    ("search",   "Find any copy *instantly*",      "search.png",   "low",  "Search your entire history"),
    ("pin",      "*Pin* what matters",             "pin.png",      "high", "Keep your favorites at the top"),
]
