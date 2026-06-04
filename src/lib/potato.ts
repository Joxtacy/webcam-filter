// Potato rendering + feature compositing.
//
// The effect: a potato tracks the user's face. Holes shaped like the user's
// eyes and mouth are cut into the scene at their real positions, showing the
// live video through them — so the potato "wears" your features. Everything
// outside the potato is filled with chroma green for keying in OBS.

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
  /** Zoom of the webcam image shown through the eye holes (1 = life-size). */
  eyeScale: number;
  /** Zoom of the webcam image shown through the mouth hole (1 = life-size). */
  mouthScale: number;
}

/** Try to load an optional user-supplied potato image from /potato.png. */
export function loadPotato(): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = "/potato.png";
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
): Array<{ x: number; y: number }> {
  const pts = indices
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

/** Trace a polygon path on the context (does not fill/stroke/clip). */
function tracePolygon(
  ctx: CanvasRenderingContext2D,
  poly: Array<{ x: number; y: number }>,
): void {
  ctx.beginPath();
  poly.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
}

/** Render one frame. Handles mirroring, greenscreen, potato + feature holes. */
export function renderFrame(p: RenderParams): void {
  const { ctx, canvasW, canvasH, video, videoW, videoH } = p;
  const t = coverTransform(videoW, videoH, canvasW, canvasH);

  ctx.clearRect(0, 0, canvasW, canvasH);

  // Mirror the whole scene (selfie view) — one flip keeps everything consistent.
  ctx.save();
  ctx.translate(canvasW, 0);
  ctx.scale(-1, 1);

  // No face / filter off → show the raw (mirrored) webcam for framing.
  if (!p.filterEnabled || !p.landmarks) {
    ctx.drawImage(video, t.dx, t.dy, t.drawW, t.drawH);
    ctx.restore();
    return;
  }

  const landmarks = p.landmarks;

  // Greenscreen everything; the potato and feature holes are drawn on top.
  ctx.fillStyle = CHROMA_GREEN;
  ctx.fillRect(0, 0, canvasW, canvasH);

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
  drawPotato(ctx, potato, p.potatoImage);

  // Cut a hole shaped like each feature, then show the live video through it.
  // `scale` grows the eye/mouth as a unit: the hole polygon and the webcam
  // image inside it are both scaled by the same factor about the feature's
  // center, so a larger eye is fully shown (not zoom-cropped) by a matching
  // larger hole.
  const features: Array<{ indices: number[]; scale: number }> = [
    { indices: RIGHT_EYE, scale: p.eyeScale },
    { indices: LEFT_EYE, scale: p.eyeScale },
    { indices: MOUTH, scale: p.mouthScale },
  ];
  for (const { indices, scale } of features) {
    const poly = featurePolygon(
      landmarks,
      indices,
      t,
      videoW,
      videoH,
      HOLE_EXPAND * scale,
    );
    if (poly.length < 3) continue;

    // Polygon centroid (canvas space) — the pivot for the content zoom.
    let cx = 0;
    let cy = 0;
    for (const pt of poly) {
      cx += pt.x;
      cy += pt.y;
    }
    cx /= poly.length;
    cy /= poly.length;

    ctx.save();
    tracePolygon(ctx, poly);
    ctx.clip();
    // Zoom the webcam image about the feature center.
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
    ctx.drawImage(video, t.dx, t.dy, t.drawW, t.drawH);
    ctx.restore();

    // Subtle rim so the hole reads as cut into the potato.
    tracePolygon(ctx, poly);
    ctx.lineWidth = Math.max(1.5, potW * 0.004);
    ctx.strokeStyle = "rgba(60,38,18,0.5)";
    ctx.stroke();
  }

  ctx.restore();
}

/** Draw the potato into a region — user image if provided, else procedural. */
function drawPotato(
  ctx: CanvasRenderingContext2D,
  region: BBox,
  image: HTMLImageElement | null,
): void {
  if (image) {
    ctx.drawImage(image, region.x, region.y, region.w, region.h);
    return;
  }

  const cx = region.x + region.w / 2;
  const cy = region.y + region.h / 2;
  const rx = region.w / 2;
  const ry = region.h / 2;

  ctx.save();
  ctx.translate(cx, cy);

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
