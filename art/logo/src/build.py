"""Build SEEK & STRIKE logo set (pure SVG geometry, black stencil)."""
import json, math, cairosvg
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

OUT = '.'
rifle = json.load(open('src/rifle.json'))
font = TTFont('fonts/SairaStencilOne-Regular.ttf')
gs = font.getGlyphSet(); cmap = font.getBestCmap()
UPM = 1000; CAPF = 688
afont = TTFont('fonts/AllertaStencil-Regular.ttf'); ags = afont.getGlyphSet(); ACAP = 737

def glyph(ch, x, base, size):
    """Return (path d, advance) of glyph scaled so cap height == size."""
    s = size / CAPF
    name = cmap[ord(ch)]
    pen = SVGPathPen(gs)
    gs[name].draw(TransformPen(pen, (s, 0, 0, -s, x, base)))
    return pen.getCommands(), gs[name].width * s

def kern_adv(text, size, track):
    return [gs[cmap[ord(c)]].width * size / CAPF + track for c in text]

# ---------- rifle-S emblem ----------
def rifle_path(x, y, scale, mirror):
    """Rifle d-string transformed: placed with top-left (x,y); mirror -> points left."""
    w = rifle['w']
    import re
    toks = re.findall(r'[MLCZ]|-?\d+\.?\d*', rifle['d'])
    out = []; nums = []
    def flush(cmd):
        pass
    res = []; i = 0
    cur = []
    for t in toks:
        if t in 'MLCZ':
            res.append(t)
        else:
            cur.append(float(t))
            if len(cur) == 2:
                px, py = cur; cur = []
                if mirror: px = w - px
                res.append(f"{x+px*scale:.2f},{y+py*scale:.2f}")
    return ' '.join(res)

def emblem(x0, y0, C, gap_ratio=0.17, cut=True):
    """Solana-style S of three slanted bars, each with a rifle cut in as stencil negative.
    Box: x0..x0+W, y0..y0+C. Returns (d, W)."""
    H = C / (3 + 2 * gap_ratio)
    g = H * gap_ratio
    k = H * 0.80            # slant offset (Solana-like ~ 32 deg)
    rh = H * 0.74           # rifle height inside bar
    sc = rh / rifle['h']
    rw = rifle['w'] * sc
    W = rw + k + H * 0.30
    d = []
    for i in range(3):
        y = y0 + i * (H + g)
        lean_right = (i != 1)   # top & bottom "/", middle "\"
        if lean_right:
            pts = [(x0 + k, y), (x0 + W, y), (x0 + W - k, y + H), (x0, y + H)]
        else:
            pts = [(x0, y), (x0 + W - k, y), (x0 + W, y + H), (x0 + k, y + H)]
        d.append('M' + ' L'.join(f'{a:.2f},{b:.2f}' for a, b in pts) + ' Z')
        if cut:
            ry = y + (H - rh) / 2
            # top/bottom rifles point right (stock low-left follows "/"), middle points left
            rx = x0 + (W - rw) / 2 + (-H*0.02 if lean_right else H*0.02)
            d.append(rifle_path(rx, ry, sc, mirror=not lean_right))
    return ' '.join(d), W

# ---------- crosshair ampersand ----------
def amp(cx, base, C, ink):
    """Allerta Stencil & with a scope reticle. Thin reticle lines are knocked out where they
    cross the glyph (evenodd XOR) and positive outside; heavy posts + mil-dot ticks only outside."""
    size = C * 1.04
    s = size / ACAP
    bp = BoundsPen(ags); ags['ampersand'].draw(bp)
    xmin, ymin, xmax, ymax = bp.bounds
    ox = cx - (xmin + xmax) / 2 * s
    pen = SVGPathPen(ags); ags['ampersand'].draw(TransformPen(pen, (s, 0, 0, -s, ox, base)))
    gd = pen.getCommands()
    gcx = cx; gcy = base - (ymin + ymax) / 2 * s
    gw2 = (xmax - xmin) * s / 2; gh2 = (ymax - ymin) * s / 2
    t = C * 0.026; T = C * 0.07
    RX = gw2 + C * 0.34      # horizontal half-length
    RY = gh2 + C * 0.30      # vertical half-length
    gap = C * 0.07
    rects = []
    def hseg(a, b, th): rects.append((min(a, b), gcy - th/2, abs(b - a), th))
    def vseg(a, b, th): rects.append((gcx - th/2, min(a, b), th, abs(b - a)))
    for sg in (-1, 1):
        hseg(gcx + sg*gap, gcx + sg*(RX - C*0.13), t)
        hseg(gcx + sg*(RX - C*0.13), gcx + sg*RX, T)
        vseg(gcy + sg*gap, gcy + sg*(RY - C*0.13), t)
        vseg(gcy + sg*(RY - C*0.13), gcy + sg*RY, T)
    parts = [gd] + [f'M{x:.2f},{y:.2f} h{w:.2f} v{h:.2f} h{-w:.2f} Z' for x, y, w, h in rects]
    # mil-dots: round dots on the thin lines, outside the glyph only
    dots = []
    r = C * 0.024
    def dot(x, y): dots.append(f'M{x-r:.2f},{y:.2f} a{r:.2f},{r:.2f} 0 1,0 {2*r:.2f},0 a{r:.2f},{r:.2f} 0 1,0 {-2*r:.2f},0 Z')
    for sg in (-1, 1):
        x1 = gcx + sg*(gw2 + C*0.09); dot(x1, gcy)
        y1 = gcy + sg*(gh2 + C*0.09); dot(gcx, y1)
    cr = C * 0.03
    centre = f'M{gcx-cr:.2f},{gcy:.2f} a{cr:.2f},{cr:.2f} 0 1,0 {2*cr:.2f},0 a{cr:.2f},{cr:.2f} 0 1,0 {-2*cr:.2f},0 Z'
    return ' '.join(parts), ' '.join(dots), centre, (gcx, gcy, RX, RY)

def wordmark(ink='#111111', bg=None, W=2048, pad=0.06):
    C = 300.0
    track = C * 0.06
    x = 0.0; base = C
    paths = []
    # S
    sd, sw = emblem(x, base - C, C); paths.append(sd); x += sw + track*1.6
    for ch in 'EEK':
        d, a = glyph(ch, x, base, C); paths.append(d); x += a + track
    x += C * 0.16
    bp = BoundsPen(ags); ags['ampersand'].draw(bp)
    agw = (bp.bounds[2]-bp.bounds[0]) * C*1.04/ACAP
    ampw = agw + 2*C*0.36
    ad, dots, centre, (gcx, gcy, RX, RY) = amp(x + ampw/2, base, C, ink)
    x += ampw + C * 0.16
    sd2, sw2 = emblem(x, base - C, C); paths.append(sd2); x += sw2 + track*1.6
    for ch in 'TRIKE':
        d, a = glyph(ch, x, base, C); paths.append(d); x += a + track
    x -= track
    total_w = x
    # tagline
    tag = 'EVERY SEEKER IS A SOLDIER.'
    tc = C * 0.26
    adv = kern_adv(tag, tc, 0)
    raw = sum(adv)
    ttrack = (total_w - raw) / (len(tag) - 1)
    ttrack = min(ttrack, tc*0.42)
    tw = raw + ttrack*(len(tag)-1)
    tx = (total_w - tw) / 2
    tbase = max(base + C*0.30, gcy + RY + C*0.06) + tc
    tpaths = []
    for ch, a in zip(tag, adv):
        if ch != ' ':
            d, _ = glyph(ch, tx, tbase, tc); tpaths.append(d)
        tx += a + ttrack
    top = min(base - C, gcy - RY); bottom = max(tbase, gcy + RY)
    vb_h = bottom - top
    p = total_w * pad
    vbx, vby, vbw, vbh = -p, top - p, total_w + 2*p, vb_h + 2*p
    H = round(W * vbh / vbw)
    bgrect = f'<rect x="{vbx}" y="{vby}" width="{vbw}" height="{vbh}" fill="{bg}"/>' if bg else ''
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="{vbx:.2f} {vby:.2f} {vbw:.2f} {vbh:.2f}">
<title>SEEK &amp; STRIKE — Every Seeker is a soldier.</title>
{bgrect}
<g fill="{ink}" fill-rule="evenodd">
<path id="wordmark" d="{' '.join(paths)}"/>
<path id="ampersand-reticle" d="{ad}"/>
<path id="reticle-centre" d="{centre} {dots}"/>
<path id="tagline" d="{' '.join(tpaths)}"/>
</g>
</svg>'''
    return svg, W, H

def icon(fg='#E9E4D4', bg1='#3A4229', bg2='#10130C', size=1024, fg_only=False):
    # Android adaptive icon: 108dp canvas, 66dp safe circle -> 626px at 1024. Keep emblem in ~560px circle.
    C = 1.0
    d, w = emblem(0, 0, 100)
    # emblem box w x 100 ; fit diagonal within safe diameter
    safe = size * 66/108 * 0.98
    s = safe / math.hypot(w, 100)
    tx = size/2 - w*s/2; ty = size/2 - 100*s/2
    bg = '' if fg_only else f'''<defs><radialGradient id="g" cx="50%" cy="42%" r="70%">
<stop offset="0" stop-color="{bg1}"/><stop offset="1" stop-color="{bg2}"/></radialGradient></defs>
<rect width="{size}" height="{size}" fill="url(#g)"/>'''
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">
{bg}
<path fill="{fg}" fill-rule="evenodd" transform="translate({tx:.2f},{ty:.2f}) scale({s:.4f})" d="{d}"/>
</svg>'''

def emblem_svg(ink='#111111', size=1024):
    d, w = emblem(0, 0, 100)
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{round(size*100/w)}" viewBox="-2 -2 {w+4:.2f} 104"><path fill="{ink}" fill-rule="evenodd" d="{d}"/></svg>'

def write(name, svg, png=None, **kw):
    open(f'{OUT}/{name}', 'w').write(svg)
    if png: cairosvg.svg2png(bytestring=svg.encode(), write_to=f'{OUT}/{png}', **kw)

svg, W, H = wordmark()
write('seek-and-strike-logo.svg', svg, 'seek-and-strike-logo-2048.png', output_width=2048)
svg2, _, _ = wordmark(bg='#F4F1E8')
write('seek-and-strike-logo-offwhite.svg', svg2, 'seek-and-strike-logo-offwhite-2048.png', output_width=2048)
svg3, _, _ = wordmark(ink='#F4F1E8', bg='#121510')
write('seek-and-strike-logo-white-on-dark.svg', svg3, 'seek-and-strike-logo-white-on-dark-2048.png', output_width=2048)
svg4, _, _ = wordmark(ink='#F4F1E8')
write('seek-and-strike-logo-white.svg', svg4, 'seek-and-strike-logo-white-2048.png', output_width=2048)
write('app-icon-1024.svg', icon(), 'app-icon-1024.png', output_width=1024)
write('app-icon-foreground-1024.svg', icon(fg_only=True), 'app-icon-foreground-1024.png', output_width=1024)
write('s-emblem.svg', emblem_svg(), 's-emblem-512.png', output_width=512)
print(W, H)
