"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { mapCursor, type MapCursorMode } from "@/components/world/room/mapCursor";
import s from "@/components/world/room/gift-rings.module.css";

const LABEL: Record<MapCursorMode, string> = {
  memory: "+ memory or wish",
  gift: "+ gift idea",
  box: "open the box",
  node: "open",
  pan: "moving",
  drag: "drag to vote",
  ui: "",
};

/**
 * The viewer's own cursor on the gift map: a named arrow that follows the
 * pointer and says what a click will do in the zone under it. Moves the DOM
 * directly, so following the mouse never re-renders the room. Portaled to the
 * body so it stays above overlays that are themselves portaled there (the
 * photo viewer); inside the room's own layer its z-index would stop at z-10.
 */
export function MapCursor({ name, color }: { name: string; color: string }) {
  const el = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.body), []);
  useEffect(() => {
    if (!host) return;
    document.body.classList.add(s.mapCursorOn!);
    const setMode = (mode: MapCursorMode) => {
      if (!el.current || !label.current) return;
      el.current.dataset.mode = mode;
      label.current.textContent = LABEL[mode];
    };
    setMode(mapCursor.mode);
    const off = mapCursor.subscribe(setMode);
    const move = (e: PointerEvent) => {
      const node = el.current;
      if (!node) return;
      node.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      node.style.opacity = "1";
      // Over the room's own panels and buttons the arrow stays, without a zone label.
      const target = e.target as HTMLElement | null;
      const overUi = !!target?.closest?.("button, a, input, textarea, [role=dialog], .paper-card") && !target.closest("[data-map-token]");
      node.dataset.ui = overUi ? "true" : "false";
    };
    const leave = () => {
      if (el.current) el.current.style.opacity = "0";
    };
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      off();
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
      document.body.classList.remove(s.mapCursorOn!);
    };
  }, [host]);
  if (!host) return null;
  return createPortal(
    <div ref={el} className={s.cursor} style={{ ["--who" as string]: color }} aria-hidden>
      <svg viewBox="0 0 20 22"><path d="M2 2l15 8-6.5 1.8L7.5 19z" /></svg>
      <b>{name}</b>
      <i ref={label} />
    </div>,
    host,
  );
}
