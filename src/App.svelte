<script lang="ts">
  import { onMount } from "svelte";
  import CameraSelect from "./components/CameraSelect.svelte";
  import FilterCanvas from "./components/FilterCanvas.svelte";
  import {
    listVideoDevices,
    primePermission,
    type VideoDevice,
  } from "./lib/camera";
  import { createLandmarker } from "./lib/faceLandmarker";
  import { loadPotato } from "./lib/potato";
  import type { FaceLandmarker } from "@mediapipe/tasks-vision";

  let landmarker = $state<FaceLandmarker | null>(null);
  let modelReady = $state(false);
  let devices = $state<VideoDevice[]>([]);
  let selectedId = $state<string | null>(null);
  let potatoImage = $state<HTMLImageElement | null>(null);
  let filterEnabled = $state(true);
  let eyeScale = $state(1.0);
  let mouthScale = $state(1.0);
  let errorMsg = $state<string | null>(null);

  async function refreshDevices() {
    try {
      devices = await listVideoDevices();
      if (!selectedId && devices.length > 0) {
        selectedId = devices[0].deviceId;
      }
    } catch (err) {
      errorMsg =
        err instanceof Error ? err.message : "Could not list cameras.";
    }
  }

  onMount(() => {
    let disposed = false;

    (async () => {
      loadPotato().then((img) => {
        if (!disposed) potatoImage = img;
      });

      try {
        await primePermission();
        await refreshDevices();
      } catch (err) {
        errorMsg =
          err instanceof Error
            ? `Camera permission denied: ${err.message}`
            : "Camera permission was denied.";
      }

      try {
        const lm = await createLandmarker();
        if (disposed) {
          lm.close();
          return;
        }
        landmarker = lm;
        modelReady = true;
      } catch (err) {
        errorMsg =
          err instanceof Error
            ? `Failed to load face model: ${err.message}`
            : "Failed to load the face detection model.";
      }
    })();

    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);

    return () => {
      disposed = true;
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        refreshDevices,
      );
      landmarker?.close();
    };
  });
</script>

<h1><span class="spud">🥔</span> Potato Face</h1>
<p class="subtitle">
  A serverless webcam filter. Your eyes and mouth, on a potato — all in your
  browser.
</p>

<div class="toolbar">
  <CameraSelect
    {devices}
    {selectedId}
    onSelect={(id) => (selectedId = id)}
  />
  <button
    class="toggle"
    aria-pressed={filterEnabled}
    onclick={() => (filterEnabled = !filterEnabled)}
  >
    {filterEnabled ? "Potato: ON" : "Potato: OFF"}
  </button>
</div>

<div class="sliders">
  <label>
    <span>Eye zoom <em>{eyeScale.toFixed(2)}×</em></span>
    <input
      type="range"
      min="0.6"
      max="2.5"
      step="0.05"
      bind:value={eyeScale}
      disabled={!filterEnabled}
    />
  </label>
  <label>
    <span>Mouth zoom <em>{mouthScale.toFixed(2)}×</em></span>
    <input
      type="range"
      min="0.6"
      max="2.5"
      step="0.05"
      bind:value={mouthScale}
      disabled={!filterEnabled}
    />
  </label>
</div>

<div class="stage-wrap">
  <FilterCanvas
    deviceId={selectedId}
    {landmarker}
    {potatoImage}
    {filterEnabled}
    {eyeScale}
    {mouthScale}
    onError={(m) => (errorMsg = m)}
  />

  {#if errorMsg}
    <div class="status error">{errorMsg}</div>
  {:else if !modelReady}
    <div class="status">Loading face model from CDN… (first load only)</div>
  {/if}
</div>

<footer>
  The background is chroma green (#00FF00) for keying in OBS. Tip: drop your own
  <code>potato.png</code> into <code>/public</code> to replace the drawn potato.
  Nothing leaves your device.
</footer>
