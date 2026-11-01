# SEEK & STRIKE — logo set

Rebuild: `python3 src/vectorize.py && python3 src/build.py` (needs `potracer`, `scipy`, `fonttools`, `cairosvg`).

| File | Use |
| --- | --- |
| `seek-and-strike-logo.svg` / `-2048.png` | Master wordmark, black ink, transparent |
| `seek-and-strike-logo-offwhite.svg` / `-2048.png` | Black on off-white #F4F1E8 |
| `seek-and-strike-logo-white-on-dark.svg` / `-2048.png` | Off-white on #121510 |
| `seek-and-strike-logo-white.svg` / `-2048.png` | Off-white ink, transparent (for dark UI) |
| `s-emblem.svg` / `-512.png` | Rifle-S emblem alone, black, transparent |
| `app-icon-1024.svg` / `.png` | 1024 store/launcher icon, olive-black radial background |
| `app-icon-foreground-1024.svg` / `.png` | Adaptive-icon foreground layer (emblem inside the 66/108 safe circle) |

All SVGs are pure paths (text outlined), no embedded fonts or bitmaps.
The S is a Solana-style three-slanted-bar S (top/bottom bars "/", middle "\"), each bar a solid
parallelogram with an M4-type rifle cut in as stencil negative space (top/bottom point right, middle left).
Both S glyphs are the same function output, height = cap height. Not the Solana Foundation logo.
`&` = Allerta Stencil ampersand with a scope reticle (thin lines knocked out through the glyph, heavy posts, mil-dots, centre dot).
Superseded drafts: `seek-and-strike-logo-v1.jpg`, `seek-and-strike-logo-v3.png` (do not ship).
