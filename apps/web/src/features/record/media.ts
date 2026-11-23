import { QUALITY_PRESETS, type RecordingQuality } from '@vlp/shared';

/** Preferred containers/codecs, best first. Safari only supports MP4. */
const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4',
];

export function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t));
}

export function isRecordingSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function'
  );
}

export function qualityPreset(quality: RecordingQuality) {
  return QUALITY_PRESETS[quality];
}

/**
 * A timer that keeps ticking in background tabs. Browsers pause requestAnimationFrame and throttle
 * main-thread timers when the tab is hidden, which is exactly when people record another window.
 * Worker timers are not throttled the same way.
 */
export function createBackgroundTicker(fps: number, onTick: () => void): () => void {
  const src = `let id; onmessage = (e) => { clearInterval(id); if (e.data > 0) id = setInterval(() => postMessage(0), e.data); };`;
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const worker = new Worker(url);
  worker.onmessage = onTick;
  worker.postMessage(Math.round(1000 / fps));
  return () => {
    worker.postMessage(0);
    worker.terminate();
    URL.revokeObjectURL(url);
  };
}

/** Screen full-frame + circular camera bubble (bottom-right), drawn onto a canvas. */
export function composeScreenAndCamera(
  screen: MediaStream,
  camera: MediaStream,
  fps: number,
): { stream: MediaStream; stop: () => void } {
  const screenVideo = Object.assign(document.createElement('video'), {
    muted: true,
    playsInline: true,
  });
  const cameraVideo = Object.assign(document.createElement('video'), {
    muted: true,
    playsInline: true,
  });
  screenVideo.srcObject = screen;
  cameraVideo.srcObject = camera;
  void screenVideo.play();
  void cameraVideo.play();

  const settings = screen.getVideoTracks()[0]?.getSettings();
  const canvas = document.createElement('canvas');
  canvas.width = settings?.width ?? 1920;
  canvas.height = settings?.height ?? 1080;
  const ctx = canvas.getContext('2d')!;

  const draw = () => {
    // Follow resolution changes (e.g. the user resizes the shared window).
    if (screenVideo.videoWidth && screenVideo.videoWidth !== canvas.width) {
      canvas.width = screenVideo.videoWidth;
      canvas.height = screenVideo.videoHeight;
    }
    ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);
    if (cameraVideo.videoWidth) {
      const size = Math.round(Math.min(canvas.width, canvas.height) * 0.24);
      const margin = Math.round(size * 0.12);
      const x = canvas.width - size - margin;
      const y = canvas.height - size - margin;
      // Centre-crop the camera into a circle.
      const side = Math.min(cameraVideo.videoWidth, cameraVideo.videoHeight);
      const sx = (cameraVideo.videoWidth - side) / 2;
      const sy = (cameraVideo.videoHeight - side) / 2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(cameraVideo, sx, sy, side, side, x, y, size, size);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(2, size * 0.02);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.stroke();
    }
  };

  const stopTicker = createBackgroundTicker(fps, draw);
  const stream = canvas.captureStream(fps);
  return {
    stream,
    stop: () => {
      stopTicker();
      stream.getTracks().forEach((t) => t.stop());
      screenVideo.srcObject = null;
      cameraVideo.srcObject = null;
    },
  };
}

/** Mixes several audio sources (mic + system audio) into one track. */
export function mixAudio(streams: MediaStream[]): { track?: MediaStreamTrack; stop: () => void } {
  const withAudio = streams.filter((s) => s.getAudioTracks().length > 0);
  if (withAudio.length === 0) return { stop: () => undefined };
  if (withAudio.length === 1)
    return { track: withAudio[0]!.getAudioTracks()[0], stop: () => undefined };

  const ctx = new AudioContext();
  const destination = ctx.createMediaStreamDestination();
  for (const s of withAudio) ctx.createMediaStreamSource(s).connect(destination);
  return { track: destination.stream.getAudioTracks()[0], stop: () => void ctx.close() };
}
