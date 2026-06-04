// Webcam device enumeration + stream lifecycle helpers.

export interface VideoDevice {
  deviceId: string;
  label: string;
}

/**
 * Enumerate available video input devices.
 *
 * Device labels are only populated once the page has been granted camera
 * permission, so callers should open a stream (or call `primePermission`)
 * before relying on `label`.
 */
export async function listVideoDevices(): Promise<VideoDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "videoinput")
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `Camera ${i + 1}`,
    }));
}

/**
 * Request camera access once so that device labels become available.
 * The returned stream is immediately stopped — it exists only to unlock
 * `enumerateDevices` labels and trigger the permission prompt.
 */
export async function primePermission(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  stopStream(stream);
}

/** Open a stream for a specific device (or the default camera if none given). */
export async function openStream(deviceId?: string): Promise<MediaStream> {
  const video: MediaTrackConstraints = deviceId
    ? { deviceId: { exact: deviceId } }
    : {};
  // Prefer a reasonable resolution; the browser will pick the closest match.
  video.width = { ideal: 1280 };
  video.height = { ideal: 720 };
  return navigator.mediaDevices.getUserMedia({ video, audio: false });
}

/** Stop every track on a stream. Safe to call with null/undefined. */
export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop());
}
