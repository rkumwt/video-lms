import { useEffect, useRef } from 'react';

/** <video> bound to a live MediaStream (muted to avoid echo). */
export function LivePreview({ stream, className }: { stream: MediaStream; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <video ref={ref} autoPlay muted playsInline className={className} aria-label="Live preview" />
  );
}
