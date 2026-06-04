<script lang="ts">
  import { onMount } from "svelte";
  import { openStream, stopStream } from "../lib/camera";
  import { renderFrame } from "../lib/potato";
  import type { FaceLandmarker } from "@mediapipe/tasks-vision";
  import type { NormalizedPoint } from "../lib/landmarks";

  let {
    deviceId,
    landmarker,
    potatoImage,
    filterEnabled,
    eyeScale,
    mouthScale,
    onError,
  }: {
    deviceId: string | null;
    landmarker: FaceLandmarker | null;
    potatoImage: HTMLImageElement | null;
    filterEnabled: boolean;
    eyeScale: number;
    mouthScale: number;
    onError: (message: string) => void;
  } = $props();

  let video: HTMLVideoElement;
  let canvas: HTMLCanvasElement;
  let stream: MediaStream | null = null;
  let raf = 0;
  let lastVideoTime = -1;
  let lastLandmarks: NormalizedPoint[] | null = null;

  // (Re)open the camera stream whenever the selected device changes.
  $effect(() => {
    const id = deviceId;
    let cancelled = false;

    (async () => {
      stopStream(stream);
      stream = null;
      lastLandmarks = null;
      try {
        const s = await openStream(id ?? undefined);
        if (cancelled) {
          stopStream(s);
          return;
        }
        stream = s;
        video.srcObject = s;
        await video.play();
      } catch (err) {
        if (!cancelled) {
          onError(
            err instanceof Error
              ? `Could not open camera: ${err.message}`
              : "Could not open camera.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      stopStream(stream);
      stream = null;
    };
  });

  onMount(() => {
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!video || video.readyState < 2 || !video.videoWidth) return;

      // Match the canvas buffer to the native video resolution.
      if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
      if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Only run detection on genuinely new frames.
      if (landmarker && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        try {
          const result = landmarker.detectForVideo(video, performance.now());
          lastLandmarks = result.faceLandmarks?.[0] ?? null;
        } catch {
          // Transient detection errors: keep the previous landmarks.
        }
      }

      renderFrame({
        ctx,
        canvasW: canvas.width,
        canvasH: canvas.height,
        video,
        videoW: video.videoWidth,
        videoH: video.videoHeight,
        landmarks: lastLandmarks,
        potatoImage,
        filterEnabled,
        eyeScale,
        mouthScale,
      });
    };

    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      stopStream(stream);
      stream = null;
    };
  });
</script>

<div class="stage">
  <!-- Hidden source video; the canvas is the visible output. -->
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={video} class="hidden-video" playsinline muted autoplay
  ></video>
  <canvas bind:this={canvas}></canvas>
</div>
