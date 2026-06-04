// MediaPipe Face Mesh landmark index sets + bounding-box helpers.
//
// FaceLandmarker returns 478 normalized points (x,y in 0..1 of the video
// frame). The index sets below pick out the contour points for each feature;
// they are the documented Face Mesh indices for the eyes and outer lips.

export interface NormalizedPoint {
  x: number;
  y: number;
  z: number;
}

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Subject's RIGHT eye — appears on the LEFT of a non-mirrored image.
export const RIGHT_EYE = [
  33, 133, 159, 145, 7, 163, 144, 153, 154, 155, 246, 161, 160, 158, 157, 173,
];

// Subject's LEFT eye — appears on the RIGHT of a non-mirrored image.
export const LEFT_EYE = [
  263, 362, 386, 374, 249, 390, 373, 380, 381, 382, 398, 384, 385, 387, 388,
  466,
];

// Outer lip contour.
export const MOUTH = [
  61, 291, 0, 17, 146, 91, 181, 84, 314, 405, 321, 375, 409, 270, 269, 267, 37,
  39, 40, 185,
];

/** Bounding box over every landmark — the whole face. */
export function faceBBox(
  landmarks: NormalizedPoint[],
  videoW: number,
  videoH: number,
): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of landmarks) {
    const px = p.x * videoW;
    const py = p.y * videoH;
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
