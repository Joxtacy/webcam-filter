// Potato rendering + feature compositing.
//
// The effect: a potato tracks the user's face. Holes shaped like the user's
// eyes and mouth are cut at their real positions, showing the live video
// through them — so the potato "wears" your features. Hole edges are feathered
// so they blend into the potato. Everything outside the potato is chroma green
// for keying in OBS. When no face is found, only the green background shows.

import {
  faceBBox,
  LEFT_EYE,
  RIGHT_EYE,
  MOUTH,
  type NormalizedPoint,
  type BBox,
} from "./landmarks";

// How much bigger than the detected face the potato is drawn.
const POTATO_SCALE = 2.0;
// Holes expanded slightly past the exact contour so the whole feature shows.
const HOLE_EXPAND = 1.15;
// Extra outward spacing for the eyes (fraction of half the eye spacing).
const EYE_SEPARATION = 0.35;
// Wide-eye effect: eye-aspect-ratio (lid gap / eye width) at a relaxed open
// eye vs. wide open, and the max extra scale applied to a fully wide eye.
const EAR_NORMAL = 0.27;
const EAR_WIDE = 0.42;
const EYE_WIDE_MAX_BOOST = 1.9;
// Open-mouth effect: mouth-aspect-ratio (lip gap / mouth width) when closed
// vs. wide open, and the max extra scale applied to a fully open mouth.
const MAR_NORMAL = 0.05;
const MAR_WIDE = 0.5;
const MOUTH_WIDE_MAX_BOOST = 1.7;
// Feather radius for hole edges, as a fraction of the potato width.
const FEATHER_FRAC = 0.014;
// Chroma key background — pure green keys cleanly in OBS.
const CHROMA_GREEN = "#00ff00";

export interface RenderParams {
  ctx: CanvasRenderingContext2D;
  canvasW: number;
  canvasH: number;
  video: HTMLVideoElement;
  videoW: number;
  videoH: number;
  landmarks: NormalizedPoint[] | null;
  potatoImage: HTMLImageElement | null;
  filterEnabled: boolean;
  /** Zoom of the eye holes + their webcam image (1 = life-size). */
  eyeScale: number;
  /** Zoom of the mouth hole + its webcam image (1 = life-size). */
  mouthScale: number;
}

interface Pt {
  x: number;
  y: number;
}

/** Try to load an optional user-supplied potato image from potato.png.
 * Resolved against the app's base URL so it works under a subpath (Pages). */
export function loadPotato(): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `${import.meta.env.BASE_URL}potato.png`;
  });
}

/** Cover-fit mapping from video pixel space to canvas pixel space. */
function coverTransform(
  videoW: number,
  videoH: number,
  canvasW: number,
  canvasH: number,
) {
  const scale = Math.max(canvasW / videoW, canvasH / videoH);
  const drawW = videoW * scale;
  const drawH = videoH * scale;
  const dx = (canvasW - drawW) / 2;
  const dy = (canvasH - drawH) / 2;
  return { scale, drawW, drawH, dx, dy };
}

type CoverT = ReturnType<typeof coverTransform>;

// Reused offscreen canvas for feathered feature compositing.
let offCanvas: HTMLCanvasElement | null = null;
let offCtx: CanvasRenderingContext2D | null = null;
function getOffscreen(w: number, h: number): CanvasRenderingContext2D {
  if (!offCanvas) {
    offCanvas = document.createElement("canvas");
    offCtx = offCanvas.getContext("2d");
  }
  if (offCanvas.width !== w) offCanvas.width = w;
  if (offCanvas.height !== h) offCanvas.height = h;
  return offCtx!;
}

/**
 * Ordered polygon (in canvas pixel space) tracing a feature's contour,
 * expanded outward from its centroid by `expand`. Points are sorted by angle
 * around the centroid so they form a clean ring.
 */
function featurePolygon(
  landmarks: NormalizedPoint[],
  indices: number[],
  t: CoverT,
  videoW: number,
  videoH: number,
  expand: number,
): Pt[] {
  const pts: Pt[] = indices
    .map((i) => landmarks[i])
    .filter(Boolean)
    .map((p) => ({ x: p.x * videoW, y: p.y * videoH }));

  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= pts.length;
  cy /= pts.length;

  pts.sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );

  return pts.map((p) => ({
    x: t.dx + (cx + (p.x - cx) * expand) * t.scale,
    y: t.dy + (cy + (p.y - cy) * expand) * t.scale,
  }));
}

/**
 * Openness ratio of a feature: vertical gap (upper→lower) divided by
 * horizontal width (corner→corner), in pixel space so the camera's aspect
 * ratio doesn't skew it. Works for both eyes (lids) and mouth (lips).
 */
function openRatio(
  lm: NormalizedPoint[],
  upper: number,
  lower: number,
  cornerA: number,
  cornerB: number,
  videoW: number,
  videoH: number,
): number {
  const dist = (a: number, b: number) =>
    Math.hypot((lm[a].x - lm[b].x) * videoW, (lm[a].y - lm[b].y) * videoH);
  const width = dist(cornerA, cornerB);
  return width > 0 ? dist(upper, lower) / width : 0;
}

/** Map an openness ratio to an extra scale: 1 at `normal`, up to `maxBoost`
 * at `wide`. Never shrinks the feature. */
function openBoost(
  ratio: number,
  normal: number,
  wide: number,
  maxBoost: number,
): number {
  const f = (ratio - normal) / (wide - normal);
  return Math.max(1, Math.min(maxBoost, 1 + f * (maxBoost - 1)));
}

/** Centroid of a polygon (simple vertex average). */
function polyCentroid(poly: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

interface Feature {
  poly: Pt[]; // hole polygon (already offset)
  center: Pt; // zoom pivot (un-offset centroid)
  offset: Pt; // outward displacement
  scale: number;
}

/** Render one frame. */
export function renderFrame(p: RenderParams): void {
  const { ctx, canvasW, canvasH, video, videoW, videoH } = p;
  const t = coverTransform(videoW, videoH, canvasW, canvasH);

  ctx.clearRect(0, 0, canvasW, canvasH);

  // Mirror the whole scene (selfie view) — one flip keeps everything consistent.
  ctx.save();
  ctx.translate(canvasW, 0);
  ctx.scale(-1, 1);

  // Filter OFF → show the raw (mirrored) webcam for framing/camera selection.
  if (!p.filterEnabled) {
    ctx.drawImage(video, t.dx, t.dy, t.drawW, t.drawH);
    ctx.restore();
    return;
  }

  // Filter ON → greenscreen first. With no face, that is all we draw.
  ctx.fillStyle = CHROMA_GREEN;
  ctx.fillRect(0, 0, canvasW, canvasH);
  if (!p.landmarks) {
    ctx.restore();
    return;
  }

  const landmarks = p.landmarks;

  // Potato region: centered on the face, scaled up.
  const face = faceBBox(landmarks, videoW, videoH);
  const faceCx = t.dx + (face.x + face.w / 2) * t.scale;
  const faceCy = t.dy + (face.y + face.h / 2) * t.scale;
  const potW = face.w * t.scale * POTATO_SCALE;
  const potH = face.h * t.scale * POTATO_SCALE;
  const potato: BBox = {
    x: faceCx - potW / 2,
    y: faceCy - potH / 2,
    w: potW,
    h: potH,
  };
  // Build the three features. Eyes are pushed apart along the line between them,
  // and eyes/mouth grow extra when opened wide.
  const rightBoost = openBoost(
    openRatio(landmarks, 159, 145, 33, 133, videoW, videoH),
    EAR_NORMAL,
    EAR_WIDE,
    EYE_WIDE_MAX_BOOST,
  );
  const leftBoost = openBoost(
    openRatio(landmarks, 386, 374, 362, 263, videoW, videoH),
    EAR_NORMAL,
    EAR_WIDE,
    EYE_WIDE_MAX_BOOST,
  );
  const mouthBoost = openBoost(
    openRatio(landmarks, 13, 14, 61, 291, videoW, videoH),
    MAR_NORMAL,
    MAR_WIDE,
    MOUTH_WIDE_MAX_BOOST,
  );
  const rightEye = featureBase(landmarks, RIGHT_EYE, t, videoW, videoH, p.eyeScale * rightBoost);
  const leftEye = featureBase(landmarks, LEFT_EYE, t, videoW, videoH, p.eyeScale * leftBoost);
  const mouth = featureBase(landmarks, MOUTH, t, videoW, videoH, p.mouthScale * mouthBoost);

  // Head roll: angle of the line from the right eye to the left eye.
  const roll = Math.atan2(
    leftEye.center.y - rightEye.center.y,
    leftEye.center.x - rightEye.center.x,
  );

  // Draw the potato rotated to match the head, under the feature holes.
  drawPotato(ctx, potato, p.potatoImage, roll);

  const eyeMid: Pt = {
    x: (rightEye.center.x + leftEye.center.x) / 2,
    y: (rightEye.center.y + leftEye.center.y) / 2,
  };
  applyOffset(rightEye, {
    x: (rightEye.center.x - eyeMid.x) * EYE_SEPARATION,
    y: (rightEye.center.y - eyeMid.y) * EYE_SEPARATION,
  });
  applyOffset(leftEye, {
    x: (leftEye.center.x - eyeMid.x) * EYE_SEPARATION,
    y: (leftEye.center.y - eyeMid.y) * EYE_SEPARATION,
  });

  const features = [rightEye, leftEye, mouth].filter((f) => f.poly.length >= 3);

  // Composite all features onto an offscreen canvas, then mask with a blurred
  // union of their polygons so the edges feather into the potato.
  const off = getOffscreen(canvasW, canvasH);
  off.setTransform(1, 0, 0, 1, 0, 0);
  off.globalCompositeOperation = "source-over";
  off.filter = "none";
  off.clearRect(0, 0, canvasW, canvasH);

  for (const f of features) {
    off.save();
    // Clip to this feature's own hole so its zoomed video can't spill into the
    // other holes (each feature draws the full frame, just transformed).
    off.beginPath();
    f.poly.forEach((p, i) => {
      if (i === 0) off.moveTo(p.x, p.y);
      else off.lineTo(p.x, p.y);
    });
    off.closePath();
    off.clip();
    // Zoom the webcam image about the feature center, plus its outward offset.
    off.translate(f.offset.x, f.offset.y);
    off.translate(f.center.x, f.center.y);
    off.scale(f.scale, f.scale);
    off.translate(-f.center.x, -f.center.y);
    off.drawImage(video, t.dx, t.dy, t.drawW, t.drawH);
    off.restore();
  }

  // Mask to the UNION of all hole polygons in a single blurred fill. Filling
  // each separately with destination-in would intersect (not union) them and
  // erase everything, since the holes don't overlap.
  const feather = Math.max(3, potW * FEATHER_FRAC);
  off.globalCompositeOperation = "destination-in";
  off.filter = `blur(${feather}px)`;
  off.fillStyle = "#000";
  off.beginPath();
  for (const f of features) {
    f.poly.forEach((p, i) => {
      if (i === 0) off.moveTo(p.x, p.y);
      else off.lineTo(p.x, p.y);
    });
    off.closePath();
  }
  off.fill();
  off.filter = "none";
  off.globalCompositeOperation = "source-over";

  ctx.drawImage(off.canvas, 0, 0);

  ctx.restore();
}

/** Build a feature's hole polygon, zoom pivot, and zero offset. */
function featureBase(
  landmarks: NormalizedPoint[],
  indices: number[],
  t: CoverT,
  videoW: number,
  videoH: number,
  scale: number,
): Feature {
  const poly = featurePolygon(
    landmarks,
    indices,
    t,
    videoW,
    videoH,
    HOLE_EXPAND * scale,
  );
  return { poly, center: polyCentroid(poly), offset: { x: 0, y: 0 }, scale };
}

/** Displace a feature's hole by `d` (the zoom pivot stays at the source). */
function applyOffset(f: Feature, d: Pt): void {
  f.offset = d;
  f.poly = f.poly.map((p) => ({ x: p.x + d.x, y: p.y + d.y }));
}

/** Draw the potato into a region — user image if provided, else procedural. */
function drawPotato(
  ctx: CanvasRenderingContext2D,
  region: BBox,
  image: HTMLImageElement | null,
  angle: number,
): void {
  const cx = region.x + region.w / 2;
  const cy = region.y + region.h / 2;

  if (image) {
    // Contain the image within the region, preserving aspect ratio.
    const ar = image.width / image.height;
    const rar = region.w / region.h;
    let w = region.w;
    let h = region.h;
    if (ar > rar) h = region.w / ar;
    else w = region.h * ar;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.drawImage(image, -w / 2, -h / 2, w, h);
    ctx.restore();
    return;
  }

  const rx = region.w / 2;
  const ry = region.h / 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);

  // Lumpy blob: a base ellipse warped by a deterministic wobble.
  ctx.beginPath();
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const wobble =
      1 +
      0.06 * Math.sin(a * 3 + 0.7) +
      0.04 * Math.sin(a * 5 + 2.1) +
      0.03 * Math.cos(a * 2);
    const x = Math.cos(a) * rx * wobble;
    const y = Math.sin(a) * ry * 0.92 * wobble;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();

  const grad = ctx.createRadialGradient(
    -rx * 0.25,
    -ry * 0.3,
    rx * 0.1,
    0,
    0,
    rx * 1.1,
  );
  grad.addColorStop(0, "#d7a86e");
  grad.addColorStop(0.6, "#b07d49");
  grad.addColorStop(1, "#7a522c");
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.lineWidth = Math.max(2, rx * 0.02);
  ctx.strokeStyle = "rgba(80,50,25,0.55)";
  ctx.stroke();

  // A few potato "eyes" (buds / dimples).
  const spots: Array<[number, number, number]> = [
    [-rx * 0.45, ry * 0.35, rx * 0.05],
    [rx * 0.5, -ry * 0.1, rx * 0.04],
    [rx * 0.15, ry * 0.55, rx * 0.045],
    [-rx * 0.1, -ry * 0.55, rx * 0.035],
  ];
  ctx.fillStyle = "rgba(70,45,22,0.55)";
  for (const [sx, sy, sr] of spots) {
    ctx.beginPath();
    ctx.ellipse(sx, sy, sr, sr * 0.7, 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
