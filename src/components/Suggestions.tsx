import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

interface Props {
  /** The input the floating list is anchored to. */
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  children: ReactNode;
  maxHeight?: number;
  /** Called on outside click or Escape. */
  onClose?: () => void;
}

const GAP = 4;
const EDGE = 8;

interface Place {
  left: number;
  width: number;
  maxHeight: number;
  openUp: boolean;
  top: number;
  bottom: number;
}

/**
 * Floating suggestion list rendered in a portal on document.body with fixed
 * positioning.
 *
 * It is deliberately NOT absolutely positioned inside the page: the POS page
 * (and its bottom bar) use `overflow: hidden`, which silently clipped the old
 * dropdown so the suggestions were fetched but never visible or clickable.
 */
export default function Suggestions({ anchorRef, open, children, maxHeight = 340, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Place | null>(null);

  useLayoutEffect(() => {
    if (!open) { setPlace(null); return; }

    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - GAP;
      const above = r.top - GAP;
      // Prefer opening downwards, but flip up when there is no room left
      // (the POS search bar sits at the very bottom of the screen).
      const openUp = below < 200 && above > below;
      const h = Math.max(120, Math.min(maxHeight, Math.round(openUp ? above : below)));
      const width = Math.min(r.width, window.innerWidth - EDGE * 2);
      const left = Math.max(EDGE, Math.min(r.left, window.innerWidth - width - EDGE));
      setPlace({ left, width, maxHeight: h, openUp, top: r.top, bottom: r.bottom });
    };

    update();
    window.addEventListener("resize", update);
    // capture=true so scrolling any inner container also repositions the list
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, anchorRef, maxHeight]);

  useEffect(() => {
    if (!open || !onClose) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !place) return null;

  const style: CSSProperties = {
    position: "fixed",
    left: place.left,
    width: place.width,
    maxHeight: place.maxHeight,
    overflowY: "auto",
    background: "white",
    border: "1px solid var(--color-border)",
    borderRadius: 8,
    boxShadow: "0 12px 32px rgba(15,23,42,0.18)",
    zIndex: 9999,
  };
  if (place.openUp) style.bottom = window.innerHeight - place.top + GAP;
  else style.top = place.bottom + GAP;

  return createPortal(<div ref={panelRef} style={style}>{children}</div>, document.body);
}
