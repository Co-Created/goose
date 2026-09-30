/**
 * Split-right display mode for MCP Apps: a panel docked to the right edge of the
 * conversation, with a draggable left edge and a remembered width.
 *
 * This is a Goose-only mode, not part of the MCP Apps spec. The panel docks to
 * the nearest ancestor marked `data-mcp-split-host`, which reserves room for it
 * through the `--mcp-split-right-width` CSS variable so the chat reflows beside
 * the panel instead of under it.
 *
 * As with PiP, the app's stable container lives in McpAppRenderer and is only
 * restyled when the mode changes, so the iframe is never remounted. This module
 * supplies the classes and styles the shell takes on in split-right and renders
 * the header and resize handle as siblings of the container.
 */

import { GripVertical, Maximize2, PanelRight, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { defineMessages, useIntl } from '../../i18n';

const i18n = defineMessages({
  fullscreen: {
    id: 'mcpAppRenderer.fullscreen',
    defaultMessage: 'Fullscreen',
  },
  backToInline: {
    id: 'mcpAppRenderer.backToInline',
    defaultMessage: 'Back to conversation',
  },
  resizeSplitPanel: {
    id: 'mcpAppRenderer.resizeSplitPanel',
    defaultMessage: 'Resize side panel',
  },
  showingInSplitRight: {
    id: 'mcpAppRenderer.showingInSplitRight',
    defaultMessage: 'Showing in side panel',
  },
  showInline: {
    id: 'mcpAppRenderer.showInline',
    defaultMessage: 'Show here',
  },
});

// Geometry

export const SPLIT_RIGHT_MIN_WIDTH = 320;
export const SPLIT_RIGHT_DEFAULT_FRACTION = 0.4;
/** Minimum width left for the conversation while the panel is open. */
export const SPLIT_RIGHT_MIN_CHAT_WIDTH = 360;
export const SPLIT_RIGHT_HEADER_HEIGHT = 36;
export const SPLIT_HOST_SELECTOR = '[data-mcp-split-host]';
export const SPLIT_WIDTH_VARIABLE = '--mcp-split-right-width';

export function clampSplitRightWidth(width: number, viewportWidth: number): number {
  const max = Math.max(SPLIT_RIGHT_MIN_WIDTH, viewportWidth - SPLIT_RIGHT_MIN_CHAT_WIDTH);
  return Math.round(Math.max(SPLIT_RIGHT_MIN_WIDTH, Math.min(max, width)));
}

export interface SplitHostRect {
  top: number;
  right: number;
  height: number;
}

// Width memory

/** Last width the user chose, shared by all panels for the lifetime of the window. */
let rememberedWidth: number | null = null;

export function loadSplitRightWidth(viewportWidth: number): number {
  return clampSplitRightWidth(
    rememberedWidth ?? viewportWidth * SPLIT_RIGHT_DEFAULT_FRACTION,
    viewportWidth
  );
}

export function saveSplitRightWidth(width: number) {
  rememberedWidth = width;
}

export function clearSplitRightWidthStore() {
  rememberedWidth = null;
}

// Hook

export interface SplitResizeHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onLostPointerCapture: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

export interface SplitRightPanelState {
  width: number;
  /** Bounds of the host the panel docks to; null until measured. */
  hostRect: SplitHostRect | null;
  resizeHandlers: SplitResizeHandlers;
}

interface UseSplitRightPanelOptions {
  /** Whether the app is currently displayed in split-right. */
  active: boolean;
  /** Any element inside the host; used to find the host. */
  anchorRef: React.RefObject<HTMLElement | null>;
}

export function useSplitRightPanel({
  active,
  anchorRef,
}: UseSplitRightPanelOptions): SplitRightPanelState {
  const [width, setWidthState] = useState(() => loadSplitRightWidth(window.innerWidth));
  const widthRef = useRef(width);
  const [hostRect, setHostRect] = useState<SplitHostRect | null>(null);

  const setWidth = useCallback((next: number) => {
    const clamped = clampSplitRightWidth(next, window.innerWidth);
    widthRef.current = clamped;
    saveSplitRightWidth(clamped);
    setWidthState(clamped);
  }, []);

  // Entering split-right restores the remembered width, re-clamped to the current window.
  useEffect(() => {
    if (!active) return;
    setWidth(loadSplitRightWidth(window.innerWidth));
  }, [active, setWidth]);

  // Track the host's bounds so the panel stays aligned with it.
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!active) return;
    const el = anchorRef.current?.closest<HTMLElement>(SPLIT_HOST_SELECTOR) ?? null;
    setHost(el);
    if (!el) return;
    const measure = () => {
      const { top, right, height } = el.getBoundingClientRect();
      setHostRect({ top, right, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      setHost(null);
    };
  }, [active, anchorRef]);

  // Reserve room in the host so the conversation reflows beside the panel.
  useEffect(() => {
    if (!active || !host) return;
    host.style.setProperty(SPLIT_WIDTH_VARIABLE, `${width}px`);
    return () => {
      host.style.removeProperty(SPLIT_WIDTH_VARIABLE);
    };
  }, [active, host, width]);

  useEffect(() => {
    if (!active) return;
    const handleResize = () => setWidth(widthRef.current);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [active, setWidth]);

  const resizeHandlers = useMemo((): SplitResizeHandlers => {
    let drag: { startX: number; originWidth: number } | null = null;
    return {
      onPointerDown: (e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag = { startX: e.clientX, originWidth: widthRef.current };
      },
      onPointerMove: (e) => {
        if (!drag) return;
        // The handle sits on the panel's left edge: dragging left widens the panel.
        setWidth(drag.originWidth + drag.startX - e.clientX);
      },
      onPointerUp: (e) => {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        drag = null;
      },
      onLostPointerCapture: () => {
        drag = null;
      },
      onKeyDown: (e) => {
        const step = e.shiftKey ? 64 : 16;
        if (e.key === 'ArrowLeft') setWidth(widthRef.current + step);
        else if (e.key === 'ArrowRight') setWidth(widthRef.current - step);
        else return;
        e.preventDefault();
      },
    };
  }, [setWidth]);

  return { width, hostRect, resizeHandlers };
}

// Shell styling

/**
 * Classes the stable app shell takes on in split-right. The frame is the docked
 * panel and holds the header; the panel is the app container below the header.
 */
export const SPLIT_RIGHT_SHELL_CLASSES = {
  frame: 'fixed z-[800] flex flex-col border-l border-border-primary bg-background-primary',
  panel: 'relative flex min-h-0 flex-1 flex-col overflow-hidden [&_iframe]:!h-full',
} as const;

export function splitRightFrameStyle(
  width: number,
  hostRect: SplitHostRect | null
): React.CSSProperties {
  return {
    width: `${width}px`,
    top: `${hostRect?.top ?? 0}px`,
    height: hostRect ? `${hostRect.height}px` : '100vh',
    right: `${hostRect ? window.innerWidth - hostRect.right : 0}px`,
  };
}

// Chrome

interface SplitRightPanelProps {
  resizeHandlers: SplitResizeHandlers;
  title: string;
  /** Omitted when the app does not support fullscreen. */
  onFullscreen?: () => void;
  onClose: () => void;
}

/**
 * Resize handle and header rendered inside the split-right frame as siblings of
 * the app container, so the app never sees them and is never remounted.
 */
export function SplitRightPanel({
  resizeHandlers,
  title,
  onFullscreen,
  onClose,
}: SplitRightPanelProps) {
  const intl = useIntl();

  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        tabIndex={0}
        aria-label={intl.formatMessage(i18n.resizeSplitPanel)}
        aria-keyshortcuts="ArrowLeft ArrowRight"
        className="absolute inset-y-0 left-0 z-30 flex w-2 cursor-col-resize items-center justify-center text-text-secondary opacity-60 outline-none hover:bg-black/10 hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-active dark:hover:bg-white/10"
        onPointerDown={resizeHandlers.onPointerDown}
        onPointerMove={resizeHandlers.onPointerMove}
        onPointerUp={resizeHandlers.onPointerUp}
        onLostPointerCapture={resizeHandlers.onLostPointerCapture}
        onKeyDown={resizeHandlers.onKeyDown}
      >
        <GripVertical size={12} />
      </div>
      <div
        className="flex shrink-0 items-center gap-1 border-b border-border-primary bg-background-primary px-2"
        style={{ height: `${SPLIT_RIGHT_HEADER_HEIGHT}px` }}
      >
        <span className="min-w-0 flex-1 truncate px-2 text-sm font-medium text-text-secondary">
          {title}
        </span>
        {onFullscreen && (
          <button
            onClick={onFullscreen}
            className="no-drag cursor-pointer rounded-md p-1.5 text-text-secondary transition-colors hover:bg-black/10 hover:text-text-primary dark:hover:bg-white/10"
            title={intl.formatMessage(i18n.fullscreen)}
            aria-label={intl.formatMessage(i18n.fullscreen)}
          >
            <Maximize2 size={16} />
          </button>
        )}
        <button
          onClick={onClose}
          className="no-drag cursor-pointer rounded-md p-1.5 text-text-secondary transition-colors hover:bg-black/10 hover:text-text-primary dark:hover:bg-white/10"
          title={intl.formatMessage(i18n.backToInline)}
          aria-label={intl.formatMessage(i18n.backToInline)}
        >
          <X size={16} />
        </button>
      </div>
    </>
  );
}

/** Compact card that stands in for the app in the chat flow while it is docked. */
export function SplitRightPlaceholder({
  title,
  onReturn,
}: {
  title: string;
  onReturn: () => void;
}) {
  const intl = useIntl();

  return (
    <div className="mt-4 mb-2 flex items-center gap-3 rounded-lg border border-border-primary bg-background-secondary px-3 py-2.5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-black/[0.04] dark:bg-white/[0.06]">
        <PanelRight size={16} className="text-text-secondary" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-text-primary">{title}</div>
        <div className="text-xs text-text-secondary">
          {intl.formatMessage(i18n.showingInSplitRight)}
        </div>
      </div>
      <button
        onClick={onReturn}
        className="cursor-pointer rounded-md border border-border-primary px-2.5 py-1 text-xs text-text-secondary transition-colors hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/5"
      >
        {intl.formatMessage(i18n.showInline)}
      </button>
    </div>
  );
}
