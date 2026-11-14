"use client";
import { StudioMark } from "./studio-mark";
import * as Dialog from "@radix-ui/react-dialog";
import { X, ArrowUpRight, ChevronDown, Info } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useAvatars } from "./avatar-provider";
export function Modal({
  title,
  description,
  children,
  open,
  onClose,
  variant = "modal",
}: {
  title: string;
  variant?: "modal" | "drawer";
  description?: string;
  children: ReactNode;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className={`modal ${variant === "drawer" ? "task-detail-drawer" : ""}`}
        >
          <div className="modal-heading">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>
                {description ||
                  "Make your changes, then save to your workspace."}
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="Close dialog">
              <X size={20} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <span className={`badge ${tone}`}>
      <i />
      {children}
    </span>
  );
}
export function Avatar({
  name,
  index = 0,
  userId,
}: {
  name: string;
  index?: number;
  userId?: string | null;
}) {
  const { urls } = useAvatars();
  const url = userId ? urls[userId] : undefined;
  const [failedUrl, setFailedUrl] = useState<string>();
  return (
    <span title={name} className={`avatar avatar-${index % 4}`}>
      {url && failedUrl !== url ? (
        <img src={url} alt="" onError={() => setFailedUrl(url)} />
      ) : (
        name
          .split(" ")
          .map((s) => s[0])
          .slice(0, 2)
          .join("")
      )}
    </span>
  );
}
export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
  bodyClassName,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h2>
            {title}{" "}
            <button
              type="button"
              className="section-help"
              aria-label={`About ${title}`}
              data-tooltip={subtitle || title}
            >
              <Info size={14} aria-hidden="true" focusable="false" />
            </button>
          </h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {bodyClassName ? (
        <div className={bodyClassName}>{children}</div>
      ) : (
        children
      )}
    </section>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-mark">
        <StudioMark />
      </span>
      <h3>{title}</h3>
      {children}
    </div>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Progress({
  value,
  color = "coral",
}: {
  value: number;
  color?: string;
}) {
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label="Completion"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
    >
      <span
        className={color}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
export function Stat({
  label,
  value,
  note,
  tone = "",
  children,
}: {
  label: string;
  value: string;
  note: string;
  tone?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`stat ${tone}`}>
      <div className="stat-label">
        {label}
        <ArrowUpRight size={18} />
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-bottom">
        <span>{note}</span>
        {children}
      </div>
    </div>
  );
}
export const statusTone = (status: string) =>
  status === "Done" || status === "Approved" || status === "Paid"
    ? "green"
    : status === "In review"
      ? "lilac"
      : status === "In progress"
        ? "amber"
        : "neutral";
