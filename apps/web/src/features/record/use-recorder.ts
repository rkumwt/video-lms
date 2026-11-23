import type { RecordingQuality, RecordingType } from '@vlp/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { composeScreenAndCamera, mixAudio, pickMimeType, qualityPreset } from './media';

export type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'paused' | 'stopped';

export interface RecordingResult {
  blob: Blob;
  durationSec: number;
  mimeType: string;
}

export interface RecorderOptions {
  mode: RecordingType;
  quality: RecordingQuality;
  micEnabled: boolean;
}

function friendlyError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError')
      return 'Permission denied. Allow screen/camera/microphone access to record.';
    if (err.name === 'NotFoundError') return 'No camera or microphone was found.';
    if (err.name === 'NotReadableError')
      return 'Your camera or microphone is in use by another app.';
  }
  return err instanceof Error ? err.message : 'Could not start recording';
}

/**
 * MediaRecorder lifecycle: request devices → compose → record (pause/resume) → Blob.
 * Every track, canvas loop and audio context is released on stop/unmount.
 */
export function useRecorder() {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const [result, setResult] = useState<RecordingResult | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const cleanupRef = useRef<(() => void)[]>([]);
  // Wall-clock bookkeeping so paused time isn't counted.
  const clockRef = useRef({ startedAt: 0, pausedMs: 0, pausedAt: 0 });

  const release = useCallback(() => {
    cleanupRef.current.forEach((fn) => fn());
    cleanupRef.current = [];
    setPreview(null);
  }, []);

  useEffect(() => release, [release]);

  // Timer for the UI.
  useEffect(() => {
    if (status !== 'recording') return;
    const id = setInterval(() => {
      const c = clockRef.current;
      setElapsedSec(Math.floor((Date.now() - c.startedAt - c.pausedMs) / 1000));
    }, 250);
    return () => clearInterval(id);
  }, [status]);

  const start = useCallback(
    async ({ mode, quality, micEnabled }: RecorderOptions) => {
      setError(null);
      setResult(null);
      setStatus('requesting');
      const preset = qualityPreset(quality);
      const cleanups: (() => void)[] = [];
      const stopAll = (s: MediaStream) => () => s.getTracks().forEach((t) => t.stop());

      try {
        const screen = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: preset.width },
            height: { ideal: preset.height },
            frameRate: { ideal: preset.frameRate },
          },
          audio: true, // system/tab audio where the browser supports it
        });
        cleanups.push(stopAll(screen));

        const mic = micEnabled
          ? await navigator.mediaDevices.getUserMedia({
              audio: { echoCancellation: true, noiseSuppression: true },
            })
          : null;
        if (mic) cleanups.push(stopAll(mic));

        let videoTrack = screen.getVideoTracks()[0]!;
        if (mode === 'SCREEN_CAMERA') {
          const camera = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 640 }, facingMode: 'user' },
          });
          cleanups.push(stopAll(camera));
          const composed = composeScreenAndCamera(screen, camera, preset.frameRate);
          cleanups.push(composed.stop);
          videoTrack = composed.stream.getVideoTracks()[0]!;
        }

        const audio = mixAudio([screen, ...(mic ? [mic] : [])]);
        cleanups.push(audio.stop);

        const stream = new MediaStream([videoTrack, ...(audio.track ? [audio.track] : [])]);
        const mimeType = pickMimeType();
        const recorder = new MediaRecorder(stream, {
          ...(mimeType && { mimeType }),
          videoBitsPerSecond: preset.videoBitsPerSecond,
          audioBitsPerSecond: 128_000,
        });
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        recorder.onstop = () => {
          const c = clockRef.current;
          const durationSec = Math.max(
            1,
            Math.round((Date.now() - c.startedAt - c.pausedMs) / 1000),
          );
          const type = recorder.mimeType || mimeType || 'video/webm';
          setResult({ blob: new Blob(chunks, { type }), durationSec, mimeType: type });
          setStatus('stopped');
          release();
        };

        // "Stop sharing" in the browser UI ends the screen track: finish the recording.
        screen.getVideoTracks()[0]!.addEventListener('ended', () => {
          if (recorder.state !== 'inactive') recorder.stop();
        });

        cleanupRef.current = cleanups;
        recorderRef.current = recorder;
        clockRef.current = { startedAt: Date.now(), pausedMs: 0, pausedAt: 0 };
        setElapsedSec(0);
        setPreview(stream);
        recorder.start(1000); // 1s chunks: bounded memory spikes, little data lost on crash
        setStatus('recording');
      } catch (err) {
        cleanups.forEach((fn) => fn());
        setError(friendlyError(err));
        setStatus('idle');
      }
    },
    [release],
  );

  const pause = useCallback(() => {
    const r = recorderRef.current;
    if (r?.state === 'recording') {
      r.pause();
      clockRef.current.pausedAt = Date.now();
      setStatus('paused');
    }
  }, []);

  const resume = useCallback(() => {
    const r = recorderRef.current;
    if (r?.state === 'paused') {
      r.resume();
      clockRef.current.pausedMs += Date.now() - clockRef.current.pausedAt;
      setStatus('recording');
    }
  }, []);

  const stop = useCallback(() => {
    const r = recorderRef.current;
    if (r && r.state !== 'inactive') {
      if (r.state === 'paused') clockRef.current.pausedMs += Date.now() - clockRef.current.pausedAt;
      r.stop();
    }
  }, []);

  const reset = useCallback(() => {
    release();
    setResult(null);
    setElapsedSec(0);
    setError(null);
    setStatus('idle');
  }, [release]);

  return { status, error, elapsedSec, preview, result, start, pause, resume, stop, reset };
}
