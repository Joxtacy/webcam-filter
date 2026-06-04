# 🥔 Potato Face

A Snapchat-style webcam filter that superimposes your eyes and mouth onto a
potato — running **entirely in your browser**, with no server.

**Live:** https://joxtacy.github.io/webcam-filter/

## How it works

- [MediaPipe Tasks Vision `FaceLandmarker`](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker)
  detects 478 face landmarks in real time (WASM + model loaded from a CDN on
  first visit, then browser-cached).
- Your eyes and mouth are cut as feathered, contour-shaped holes into a
  face-tracking potato drawn on a `<canvas>`.
- Everything outside the potato is filled with chroma green (`#00FF00`) so you
  can key it out in OBS.

Features: pick your camera, potato on/off, eye/mouth zoom sliders, eyes and
mouth grow when opened wide, and the potato rotates with your head.

> First load needs an internet connection to fetch the face model from the CDN.
> The camera requires a secure context — `localhost` in dev, HTTPS in
> production (GitHub Pages provides it).

## Develop

Requires [pnpm](https://pnpm.io/).

```bash
pnpm install
pnpm dev        # start the dev server (http://localhost:5173)
pnpm build      # production build → dist/
pnpm preview    # serve the production build locally
pnpm check      # type-check (svelte-check + tsc)
```

Open the dev URL in Chrome and grant camera permission.

## Custom potato

Drop a **`potato.png`** with a transparent background into `public/` to replace
the drawn placeholder potato. See [`public/README.md`](public/README.md) for
details.

## Tech

Svelte 5 (runes) · TypeScript · Vite · `@mediapipe/tasks-vision`. Fully static —
no backend.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds with
pnpm and publishes `dist/` to GitHub Pages. The production build uses a
`/webcam-filter/` base path to match the Pages subpath (set in
`vite.config.ts`).
