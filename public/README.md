# public/

Files here are served at the site root by Vite (e.g. `public/potato.png` →
`/potato.png`).

## Custom potato

Drop a file named **`potato.png`** in this folder and it will automatically
replace the drawn placeholder potato. No code changes or restart needed in dev
— just reload the page.

Recommendations:

- **Transparent background (PNG).** Anything non-transparent will cover the
  green screen and show as a rectangle. Crop the potato to its outline with
  alpha transparency around it.
- Roughly square-ish framing works best; the image is scaled to fit the
  face-tracked region while preserving its aspect ratio.
- The eye/mouth holes are positioned over the face, so leave the central area
  of the potato clear of important detail.
