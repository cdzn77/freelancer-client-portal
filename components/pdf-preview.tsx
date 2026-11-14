"use client";
import { useEffect, useRef, useState } from "react";
import type { ReviewFeedback } from "@/lib/studio-workflows";
type Anchor = ReviewFeedback["annotation"];
type Rect = { x: number; y: number; width: number; height: number };
export function PDFPreview({
  url,
  page,
  pins,
  draft,
  onPin,
  onSelect,
  onValid,
}: {
  url: string;
  page: number;
  pins?: ReviewFeedback[];
  draft?: Anchor;
  onPin?: (a: Anchor) => void;
  onSelect?: (id: string) => void;
  onValid?: (valid: boolean) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    start = useRef<{ x: number; y: number } | null>(null),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    [pages, setPages] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let task: import("pdfjs-dist").PDFDocumentLoadingTask | undefined;
    setReady(false);
    setError("");
    onValid?.(false);
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        if (cancelled) return;
        pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs";
        task = pdfjs.getDocument({ url });
        const pdf = await task.promise;
        if (cancelled) return;
        setPages(pdf.numPages);
        if (page > pdf.numPages)
          throw Error(
            `This document has ${pdf.numPages} pages. Choose a page in that range.`,
          );
        const sheet = await pdf.getPage(page),
          viewport = sheet.getViewport({ scale: 1.5 });
        if (cancelled || !canvas.current) return;
        const c = canvas.current;
        c.width = viewport.width;
        c.height = viewport.height;
        await sheet.render({ canvas: c, viewport }).promise;
        if (!cancelled) {
          setReady(true);
          onValid?.(true);
        }
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          onValid?.(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [url, page, onValid]);
  const style = (r: Rect) => ({
    left: `${r.x * 100}%`,
    top: `${r.y * 100}%`,
    width: `${r.width * 100}%`,
    height: `${r.height * 100}%`,
  });
  function point(e: React.PointerEvent<HTMLButtonElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  }
  return (
    <>
      <p className="muted">
        {error ||
          (!ready
            ? "Rendering PDF…"
            : `Page ${page} of ${pages}${onPin ? " · Drag to mark an area, or use Select center area below." : ""}`)}
      </p>
      <div
        className="pdf-page-canvas"
        style={{ display: error ? "none" : undefined }}
      >
        <canvas ref={canvas} aria-label={`PDF page ${page}`} />
        {ready && onPin && (
          <button
            type="button"
            className="review-image-target"
            aria-label="Select PDF area; keyboard activation selects center"
            onPointerDown={(e) => {
              start.current = point(e);
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerCancel={() => {
              start.current = null;
            }}
            onPointerUp={(e) => {
              if (!start.current) return;
              const end = point(e),
                first = start.current;
              start.current = null;
              const x = Math.min(first.x, end.x),
                y = Math.min(first.y, end.y),
                width = Math.abs(first.x - end.x),
                height = Math.abs(first.y - end.y);
              if (width > 0.005 && height > 0.005)
                onPin({ type: "pdf", page, rect: { x, y, width, height } });
            }}
            onClick={(e) => {
              if (e.detail === 0)
                onPin({
                  type: "pdf",
                  page,
                  rect: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
                });
            }}
          />
        )}
        {ready &&
          pins?.map(
            (f, i) =>
              f.annotation?.type === "pdf" &&
              f.annotation.page === page &&
              f.annotation.rect && (
                <button
                  type="button"
                  key={f.id}
                  className="pdf-area"
                  style={style(f.annotation.rect)}
                  onClick={() => onSelect?.(f.id)}
                  aria-label={`Feedback ${i + 1}: ${f.body}`}
                >
                  <span>{i + 1}</span>
                </button>
              ),
          )}
        {ready &&
          draft?.type === "pdf" &&
          draft.page === page &&
          draft.rect && (
            <span
              className="pdf-area draft"
              style={style(draft.rect)}
              aria-label="New feedback area"
            />
          )}
      </div>
      <a href={`${url}#page=${page}`} target="_blank" rel="noopener noreferrer">
        Open PDF in a separate tab
      </a>
    </>
  );
}
