"use client";
import { useEffect, useRef, useState } from "react";
/** One delegated tooltip layer also covers controls rendered inside dialog portals. */
export function Tooltips() {
  const [tip, setTip] = useState<{
    text: string;
    left: number;
    top: number;
    above: boolean;
  } | null>(null);
  const active = useRef<HTMLElement | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    function clear() {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      const el = active.current;
      if (el) {
        const ids = (el.getAttribute("aria-describedby") || "")
          .split(" ")
          .filter((x) => x && x !== "control-help");
        if (ids.length) el.setAttribute("aria-describedby", ids.join(" "));
        else el.removeAttribute("aria-describedby");
      }
      active.current = null;
      setTip(null);
    }
    function show(e: Event) {
      const target = e.target as HTMLElement;
      if (target.closest?.("#control-help")) {
        if (timer.current) clearTimeout(timer.current);
        return;
      }
      const el = target.closest?.<HTMLElement>(
        "[data-tooltip],button,a[href],select,input,textarea,[title]",
      );
      if (!el) return;
      if (el.closest("[data-no-auto-tooltip]")) {
        clear();
        return;
      }
      if (active.current === el) return;
      clear();
      const text =
        el.dataset.tooltip ||
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        el.closest("label")?.innerText ||
        el.innerText?.trim();
      if (!text) return;
      const r = el.getBoundingClientRect();
      active.current = el;
      el.setAttribute(
        "aria-describedby",
        [el.getAttribute("aria-describedby"), "control-help"]
          .filter(Boolean)
          .join(" "),
      );
      const above =
        !!el.closest('[data-tooltip-position="above"]') ||
        r.bottom > window.innerHeight - 90;
      setTip({
        text: text.slice(0, 300),
        left: Math.max(
          12,
          Math.min(
            el.closest("nav") && window.innerWidth > 800 ? r.right + 8 : r.left,
            window.innerWidth - 292,
          ),
        ),
        top: above
          ? r.top - 6
          : el.closest("nav") && window.innerWidth > 800
            ? r.top
            : r.bottom + 6,
        above,
      });
    }
    function leave(e: Event) {
      const related = (e as MouseEvent).relatedTarget as HTMLElement | null;
      if (
        related &&
        (related.closest?.("#control-help") ||
          active.current?.contains(related))
      )
        return;
      timer.current = setTimeout(clear, 180);
    }
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") clear();
    }
    document.addEventListener("click", clear, true);
    document.addEventListener("pointerover", show);
    document.addEventListener("focusin", show);
    document.addEventListener("pointerout", leave);
    document.addEventListener("focusout", leave);
    document.addEventListener("keydown", key, true);
    window.addEventListener("scroll", clear, true);
    return () => {
      clear();
      document.removeEventListener("click", clear, true);
      document.removeEventListener("pointerover", show);
      document.removeEventListener("focusin", show);
      document.removeEventListener("pointerout", leave);
      document.removeEventListener("focusout", leave);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", clear, true);
    };
  }, []);
  return tip ? (
    <aside aria-label="Control help">
      <div
        id="control-help"
        role="tooltip"
        className="control-tooltip"
        style={{
          left: tip.left,
          top: tip.top,
          transform: tip.above ? "translateY(-100%)" : undefined,
        }}
      >
        {tip.text}
      </div>
    </aside>
  ) : null;
}
