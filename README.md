# Manzia — scroll-scrubbed landing page

Apple-style scroll animation: 238 video frames (`frames/*.webp`) are drawn to a
`<canvas>` and scrubbed by scroll position, with lerp smoothing for a buttery feel.

No build step, no dependencies. Open with any static server:

```bash
python3 -m http.server 8000
```

## Tuning (script.js)
- `LERP` — smoothing (0.06 = silky/floaty, 0.2 = snappy).
- `.sequence { height: 600vh }` in styles.css — longer = slower scrub.
- Text beats: `data-start` / `data-end` on each `.beat` (0–1 of the sequence).

## Features
- Progressive frame preloading (coarse keyframes first, detail fills in).
- DPR-aware, cover-fit canvas, nearest-frame fallback while loading.
- Text beats fade/slide/blur in sync with the footage.
- Word-by-word scroll highlight, count-up stats, velocity-reactive marquee,
  parallax images, 3D card tilt, scroll progress bar.
- Respects `prefers-reduced-motion`; mobile layout included.
