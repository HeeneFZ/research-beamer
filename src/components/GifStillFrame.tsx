import { useEffect, useRef } from 'react';
import { fileUrl } from './pdfRaster';

// Retain one poster, then release the native animation decoder.
export function GifStillFrame({ abs, onAspect, onError, print = false }: {
  abs: string; onAspect: (aspect: number) => void; onError: () => void; print?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    const image = new Image();
    const fail = () => {
      if (!alive) return;
      if (ref.current) { ref.current.dataset.mediaError = 'GIF 加载失败'; delete ref.current.dataset.mediaPending; }
      onError();
    };
    image.onload = () => {
      if (!alive) return;
      if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) { fail(); return; }
      onAspect(image.naturalWidth / image.naturalHeight);
      const canvas = ref.current;
      if (!canvas) return;
      const scale = print ? Math.min(1, Math.sqrt(16 * 1024 * 1024 / (image.naturalWidth * image.naturalHeight)))
        : Math.min(1, 512 / image.naturalWidth, 512 / image.naturalHeight);
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
      delete canvas.dataset.mediaPending;
      canvas.dispatchEvent(new Event('mediaready', { bubbles: true }));
      image.onload = image.onerror = null; image.src = '';
    };
    image.onerror = fail; image.src = fileUrl(abs);
    return () => { alive = false; image.onload = image.onerror = null; image.src = ''; };
  }, [abs, onAspect, onError, print]);
  return <canvas ref={ref} className="gif-still" data-gif-source={abs} data-media-pending="true" width={0} height={0} />;
}
