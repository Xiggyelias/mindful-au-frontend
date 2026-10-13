import React, { useState, useEffect, useCallback, useRef } from "react";
import { 
  ArrowLeft, 
  Download, 
  RotateCw, 
  X, 
  ZoomIn, 
  ZoomOut, 
  Maximize2,
  Minimize2,
  FileImage,
  Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface ChatMediaLightboxProps {
  isOpen: boolean;
  onClose: () => void;
  src: string;
  alt?: string;
  fileName?: string;
  fileSize?: string;
  senderName?: string;
  timestamp?: string;
  caption?: string;
  onDownload?: () => void;
  isDownloading?: boolean;
}

export const ChatMediaLightbox: React.FC<ChatMediaLightboxProps> = ({
  isOpen,
  onClose,
  src,
  alt = "Image preview",
  fileName = "Photo",
  fileSize,
  senderName,
  timestamp,
  caption,
  onDownload,
  isDownloading = false,
}) => {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Reset viewport state whenever a new image opens or lightbox closes
  useEffect(() => {
    if (isOpen) {
      setZoom(1);
      setRotation(0);
      setPan({ x: 0, y: 0 });
      setIsDragging(false);
    }
  }, [isOpen, src]);

  // Keyboard navigation: Escape to close, + / - to zoom, r to rotate
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        setZoom((prev) => Math.min(prev + 0.25, 3.5));
      } else if (e.key === "-") {
        e.preventDefault();
        setZoom((prev) => Math.max(prev - 0.25, 0.5));
      } else if (e.key === "0") {
        e.preventDefault();
        setZoom(1);
        setPan({ x: 0, y: 0 });
      } else if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        setRotation((prev) => (prev + 90) % 360);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Lock background scroll when open
  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.25, 3.5));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.25, 0.5));
  const handleRotate = () => setRotation((prev) => (prev + 90) % 360);
  const handleResetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
  };

  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      void document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Pointer drag for panning when zoomed in
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (zoom <= 1) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || zoom <= 1) return;
    setPan({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  const handleDoubleTap = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (zoom > 1) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    } else {
      setZoom(2);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
      className="fixed inset-0 z-[200] flex flex-col bg-black/95 backdrop-blur-xl text-white select-none animate-in fade-in duration-200"
      onClick={onClose}
    >
      {/* Top Navigation & Controls Bar */}
      <header
        className="flex items-center justify-between gap-3 px-3 py-2.5 sm:px-6 sm:py-3 bg-gradient-to-b from-black/80 via-black/40 to-transparent z-10 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: Back button + Sender Info */}
        <div className="flex items-center gap-3 min-w-0">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 text-white hover:bg-white/15 rounded-full shrink-0"
            onClick={onClose}
            aria-label="Back to chat"
            title="Back to chat (Esc)"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>

          <div className="min-w-0 flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm sm:text-base truncate max-w-[200px] sm:max-w-xs">
                {senderName || fileName}
              </span>
              {fileSize && (
                <Badge
                  variant="outline"
                  className="hidden sm:inline-flex border-white/25 text-white/80 text-[11px] px-1.5 py-0"
                >
                  {fileSize}
                </Badge>
              )}
            </div>
            {timestamp && (
              <span className="text-[11px] sm:text-xs text-white/60">
                {timestamp}
              </span>
            )}
          </div>
        </div>

        {/* Right: Zoom, Rotate, Download, Fullscreen & Close Controls */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <div className="hidden sm:flex items-center bg-white/10 rounded-full px-1 py-0.5 border border-white/10">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-white/90 hover:bg-white/20 rounded-full"
              onClick={handleZoomOut}
              disabled={zoom <= 0.5}
              title="Zoom out (-)"
              aria-label="Zoom out"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <button
              type="button"
              className="px-2 text-xs font-mono text-white/80 hover:text-white"
              onClick={handleResetZoom}
              title="Reset zoom (0)"
            >
              {Math.round(zoom * 100)}%
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-white/90 hover:bg-white/20 rounded-full"
              onClick={handleZoomIn}
              disabled={zoom >= 3.5}
              title="Zoom in (+)"
              aria-label="Zoom in"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-white/90 hover:bg-white/15 rounded-full"
            onClick={handleRotate}
            title="Rotate 90° (R)"
            aria-label="Rotate"
          >
            <RotateCw className="h-4 w-4" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-white/90 hover:bg-white/15 rounded-full hidden sm:inline-flex"
            onClick={handleToggleFullscreen}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            aria-label="Toggle fullscreen"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>

          {onDownload && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 px-3 gap-1.5 text-white/90 hover:bg-white/15 rounded-full text-xs font-medium"
              onClick={onDownload}
              disabled={isDownloading}
              title="Save image to device"
              aria-label="Download image"
            >
              {isDownloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              <span className="hidden md:inline">Save</span>
            </Button>
          )}

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-white/90 hover:bg-white/15 rounded-full ml-1"
            onClick={onClose}
            title="Close viewer (Esc)"
            aria-label="Close viewer"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </header>

      {/* Main Image Stage */}
      <main
        className="relative flex-1 flex items-center justify-center p-2 sm:p-6 overflow-hidden cursor-zoom-in"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleTap}
        style={{ cursor: zoom > 1 ? (isDragging ? "grabbing" : "grab") : "default" }}
      >
        <div
          className="relative max-h-full max-w-full flex items-center justify-center transition-transform duration-100 ease-out will-change-transform"
          style={{
            transform: `scale(${zoom}) rotate(${rotation}deg) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <img
            src={src}
            alt={alt}
            className="max-h-[82vh] max-w-[94vw] object-contain rounded-lg shadow-2xl drop-shadow-[0_20px_50px_rgba(0,0,0,0.8)] pointer-events-auto"
            draggable={false}
          />
        </div>
      </main>

      {/* Bottom Caption Pill (WhatsApp style) */}
      {caption && (
        <footer
          className="p-4 flex items-center justify-center z-10 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="max-w-2xl rounded-2xl bg-black/70 backdrop-blur-md border border-white/15 px-4 py-2.5 text-center text-sm text-white/90 shadow-xl">
            {caption}
          </div>
        </footer>
      )}
    </div>
  );
};
