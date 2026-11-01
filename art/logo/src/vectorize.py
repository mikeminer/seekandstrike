# Vectorize the top (right-pointing) rifle of s-emblem.jpg with potrace (potracer).
import numpy as np, potrace, json
from PIL import Image
im = np.array(Image.open('s-emblem.jpg').convert('L')).astype(float)
crop = im[195:400, 255:830]          # top rifle
bm = crop < 128
# keep largest connected components only (remove specks)
from scipy import ndimage
lab, n = ndimage.label(bm)
sizes = ndimage.sum(bm, lab, range(1, n+1))
keep = np.isin(lab, [i+1 for i,s in enumerate(sizes) if s > 40])
ys, xs = np.nonzero(keep)
keep = keep[ys.min():ys.max()+1, xs.min():xs.max()+1]
h, w = keep.shape
path = potrace.Bitmap(~keep).trace(turdsize=8, alphamax=0.9, opticurve=True, opttolerance=0.2)
def f(p): return f"{p.x:.2f},{p.y:.2f}"
d = []
for c in path:
    d.append("M" + f(c.start_point))
    for s in c.segments:
        if s.is_corner: d.append("L" + f(s.c) + "L" + f(s.end_point))
        else: d.append("C" + f(s.c1) + " " + f(s.c2) + " " + f(s.end_point))
    d.append("Z")
json.dump({"w": w, "h": h, "d": "".join(d)}, open('src/rifle.json', 'w'))
print(w, h, len(path), len("".join(d)))
