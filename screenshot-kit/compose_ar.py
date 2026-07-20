# Renders the Arabic set. Swaps config_ar.py in as `config` (compose.py imports
# `config` by name), then drives the same render entry points compose.py uses.
import sys, os
sys.path.insert(0, os.getcwd())
import config_ar
sys.modules['config'] = config_ar
import compose

compose.hero(os.path.join(compose.RAW, config_ar.HERO_SHOT))
for i, (label, headline, shot, vpos, sub) in enumerate(config_ar.PANELS, start=3):
    compose.panel(i, label, headline, os.path.join(compose.RAW, shot), vpos, sub)
print("done ->", config_ar.OUT_DIR)
