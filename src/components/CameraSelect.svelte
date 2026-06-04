<script lang="ts">
  import type { VideoDevice } from "../lib/camera";

  let {
    devices,
    selectedId,
    onSelect,
  }: {
    devices: VideoDevice[];
    selectedId: string | null;
    onSelect: (deviceId: string) => void;
  } = $props();
</script>

<label for="camera-select">Camera</label>
<select
  id="camera-select"
  value={selectedId ?? ""}
  disabled={devices.length === 0}
  onchange={(e) => onSelect((e.currentTarget as HTMLSelectElement).value)}
>
  {#if devices.length === 0}
    <option value="">No cameras found</option>
  {:else}
    {#each devices as device (device.deviceId)}
      <option value={device.deviceId}>{device.label}</option>
    {/each}
  {/if}
</select>
