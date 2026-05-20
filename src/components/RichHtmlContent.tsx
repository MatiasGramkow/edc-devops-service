"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

// --- Sanitization ---

function proxyImageUrl(src: string): string {
  return `/api/image-proxy?url=${encodeURIComponent(src)}`;
}

export function sanitizeHtmlWithImages(html: string): string {
  const ALLOWED_TAGS = /^(p|br|div|ul|ol|li|strong|b|em|i|a|img|h[1-6]|span|table|tr|td|th|thead|tbody|pre|code|hr)$/i;

  // Rewrite Azure DevOps image URLs to go through our proxy
  let result = html.replace(/<img\s+[^>]*>/gi, (imgTag) => {
    return imgTag.replace(/src=["']([^"']+)["']/gi, (_match, src: string) => {
      if (src.startsWith("https://dev.azure.com/")) {
        return `src="${proxyImageUrl(src)}"`;
      }
      return `src="${src}"`;
    });
  });

  // Strip disallowed tags but keep content; keep allowed tags
  result = result.replace(/<\/?([a-z][a-z0-9]*)\b[^>]*\/?>/gi, (tag, tagName: string) => {
    if (ALLOWED_TAGS.test(tagName)) return tag;
    if (/^(div|p)$/i.test(tagName) && tag.startsWith("</")) return "\n";
    return "";
  });

  // Remove any script/style/event handlers
  result = result.replace(/\s*on\w+="[^"]*"/gi, "");
  result = result.replace(/\s*on\w+='[^']*'/gi, "");
  result = result.replace(/<script[\s\S]*?<\/script>/gi, "");
  result = result.replace(/<style[\s\S]*?<\/style>/gi, "");

  return result.trim();
}

// --- Image Lightbox ---

function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const [zoomed, setZoomed] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  function handleWheel(e: React.WheelEvent) {
    e.stopPropagation();
    if (e.deltaY > 0 && zoomed) {
      setZoomed(false);
      setPan({ x: 0, y: 0 });
    } else if (e.deltaY < 0 && !zoomed) {
      setZoomed(true);
    }
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (!zoomed) return;
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    setPan((prev) => ({
      x: prev.x + e.clientX - lastPos.current.x,
      y: prev.y + e.clientY - lastPos.current.y,
    }));
    lastPos.current = { x: e.clientX, y: e.clientY };
  }

  function handlePointerUp() {
    dragging.current = false;
  }

  function handleImageClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (zoomed) {
      setZoomed(false);
      setPan({ x: 0, y: 0 });
    } else {
      setZoomed(true);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 rounded-full bg-black/50 p-2 text-white/80 hover:text-white transition-colors"
      >
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1.5 text-xs text-white/60">
        {zoomed ? "Click or scroll to zoom out — drag to pan" : "Click or scroll to zoom in"}
      </div>

      <div
        className="max-h-[90vh] max-w-[90vw] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <img
          src={src}
          alt=""
          onClick={handleImageClick}
          className="transition-transform duration-200 ease-out select-none"
          style={{
            cursor: zoomed ? "grab" : "zoom-in",
            transform: zoomed ? `scale(2.5) translate(${pan.x / 2.5}px, ${pan.y / 2.5}px)` : "scale(1)",
            maxHeight: "90vh",
            maxWidth: "90vw",
            objectFit: "contain",
          }}
          draggable={false}
        />
      </div>
    </div>,
    document.body
  );
}

// --- RichHtmlContent (prose + lightbox) ---

export function RichHtmlContent({ html, className }: { html: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "IMG") {
        e.preventDefault();
        setLightboxSrc((target as HTMLImageElement).src);
      }
    }
    el.addEventListener("click", handleClick);
    return () => el.removeEventListener("click", handleClick);
  }, [html]);

  return (
    <>
      <div
        ref={containerRef}
        className={className}
        dangerouslySetInnerHTML={{ __html: sanitizeHtmlWithImages(html) }}
      />
      {lightboxSrc && <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </>
  );
}
