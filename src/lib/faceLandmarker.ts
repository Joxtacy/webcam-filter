// MediaPipe Tasks Vision FaceLandmarker setup.
//
// The JS API ships in the npm package; the WASM runtime and the model file are
// loaded from a CDN on first use (then cached by the browser). No own server
// is required.

import {
  FilesetResolver,
  FaceLandmarker,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";

const CDN_WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm";
const CDN_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export type { FaceLandmarkerResult };

/**
 * Create and warm up a FaceLandmarker configured for video. Tries the GPU
 * delegate first and transparently falls back to CPU if the GPU backend is
 * unavailable.
 */
export async function createLandmarker(): Promise<FaceLandmarker> {
  const filesetResolver = await FilesetResolver.forVisionTasks(CDN_WASM_URL);

  const makeOptions = (delegate: "GPU" | "CPU") => ({
    baseOptions: {
      modelAssetPath: CDN_MODEL_URL,
      delegate,
    },
    runningMode: "VIDEO" as const,
    numFaces: 1,
  });

  try {
    return await FaceLandmarker.createFromOptions(
      filesetResolver,
      makeOptions("GPU"),
    );
  } catch (err) {
    console.warn("FaceLandmarker GPU delegate failed, falling back to CPU", err);
    return FaceLandmarker.createFromOptions(filesetResolver, makeOptions("CPU"));
  }
}
