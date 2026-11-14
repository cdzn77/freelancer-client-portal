"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { safeLink, type DiscussionPerson } from "@/lib/collaboration";
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
function inline(text: string): ReactNode[] {
  const re =
    /(\*\*[^*]+\*\*|~~[^~]+~~|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\([^\s)]+\))/g;
  return text
    .split(re)
    .filter(Boolean)
    .map((s, i) =>
      s.startsWith("**") ? (
        <strong key={i}>{s.slice(2, -2)}</strong>
      ) : s.startsWith("~~") ? (
        <s key={i}>{s.slice(2, -2)}</s>
      ) : s.startsWith("`") ? (
        <code key={i}>{s.slice(1, -1)}</code>
      ) : s.startsWith("*") ? (
        <em key={i}>{s.slice(1, -1)}</em>
      ) : s.startsWith("[") && s.match(/^\[([^\]]+)\]\(([^)]+)\)$/) ? (
        (() => {
          const m = s.match(/^\[([^\]]+)\]\(([^)]+)\)$/)!;
          const href = safeLink(m[2]);
          return href ? (
            <a key={i} href={href} target="_blank" rel="noopener noreferrer">
              {m[1]}
            </a>
          ) : (
            <span key={i}>{m[1]}</span>
          );
        })()
      ) : (
        s
      ),
    );
}
export function DiscussionText({ text }: { text: string }) {
  return (
    <div className="discussion-rich-text">
      {text.split("\n").map((line, i) =>
        line.startsWith("- ") ? (
          <div className="discussion-list-item" key={i}>
            <span aria-hidden>• </span>
            {inline(line.slice(2))}
          </div>
        ) : /^\d+\. /.test(line) ? (
          <div className="discussion-list-item" key={i}>
            {inline(line)}
          </div>
        ) : line.startsWith("> ") ? (
          <blockquote key={i}>{inline(line.slice(2))}</blockquote>
        ) : (
          <p key={i}>{line ? inline(line) : <br />}</p>
        ),
      )}
    </div>
  );
}
function editorHtml(text: string) {
  return text
    .split("\n")
    .map(
      (line) =>
        "<div>" +
        escape(line)
          .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
          .replace(/~~([^~]+)~~/g, "<s>$1</s>")
          .replace(/`([^`]+)`/g, "<code>$1</code>")
          .replace(/\*([^*]+)\*/g, "<em>$1</em>") +
        "</div>",
    )
    .join("");
}
function serialize(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
  const el = node as HTMLElement,
    tag = el.tagName;
  const content = Array.from(node.childNodes).map(serialize).join("");
  if (tag === "BR") return "\n";
  if (tag === "B" || tag === "STRONG") return `**${content}**`;
  if (tag === "I" || tag === "EM") return `*${content}*`;
  if (tag === "S" || tag === "STRIKE") return `~~${content}~~`;
  if (tag === "CODE") return "`" + content + "`";
  if (tag === "A") {
    const href = safeLink(el.getAttribute("href") || "");
    return href ? `[${content}](${href})` : content;
  }
  if (tag === "LI")
    return `${el.parentElement?.tagName === "OL" ? "1." : "-"} ${content.trim()}\n`;
  if (["DIV", "P", "UL", "OL", "BLOCKQUOTE"].includes(tag))
    return content + "\n";
  return content;
}
export function DiscussionEditor({
  initial = "",
  onChange,
  people = [],
  teams = [],
  onMention,
  onTyping,
  disabled = false,
  label = "Comment",
  resetKey = 0,
  onFiles,
}: {
  initial?: string;
  onChange: (s: string) => void;
  people?: DiscussionPerson[];
  teams?: { name: string }[];
  onMention?: (id: string, group: boolean) => void;
  onTyping?: () => void;
  disabled?: boolean;
  label?: string;
  resetKey?: string | number;
  onFiles?: (files: File[]) => void;
}) {
  const ref = useRef<HTMLDivElement>(null),
    saved = useRef<Range | null>(null);
  const [query, setQuery] = useState<string | null>(null),
    [link, setLink] = useState(false),
    [url, setUrl] = useState("");
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = editorHtml(initial);
    setQuery(null);
  }, [resetKey]); // initial is deliberately applied only when the draft changes.
  const change = () => {
    if (ref.current) {
      const value = Array.from(ref.current.childNodes)
        .map(serialize)
        .join("")
        .trimEnd();
      onChange(value);
      onTyping?.();
      const text = window
        .getSelection()
        ?.anchorNode?.textContent?.slice(
          0,
          window.getSelection()?.anchorOffset,
        );
      setQuery(text?.match(/(?:^|\s)@([\w -]*)$/)?.[1] ?? null);
    }
  };
  const command = (name: string, value?: string) => {
    ref.current?.focus();
    document.execCommand(name, false, value);
    change();
  };
  const groups = [
    "here",
    "project",
    "everyone",
    "leader",
    "assignee",
    ...teams.map((t) => "team:" + t.name),
  ];
  const pick = (value: string, name: string, isGroup: boolean) => {
    const sel = window.getSelection();
    ref.current?.focus();
    if (saved.current && sel) {
      sel.removeAllRanges();
      sel.addRange(saved.current);
    }
    const node = sel?.anchorNode,
      offset = sel?.anchorOffset || 0;
    if (query !== null && node?.nodeType === Node.TEXT_NODE) {
      const start = (node.textContent || "").lastIndexOf("@", offset);
      if (start >= 0) {
        const r = document.createRange();
        r.setStart(node, start);
        r.setEnd(node, offset);
        sel!.removeAllRanges();
        sel!.addRange(r);
      }
    }
    command("insertText", "@" + name + " ");
    onMention?.(value, isGroup);
    setQuery(null);
  };
  return (
    <div className="discussion-editor">
      <div
        className="discussion-format-toolbar"
        role="toolbar"
        aria-label={`${label} formatting`}
      >
        {(
          [
            ["bold", "Bold", "B"],
            ["italic", "Italic", "I"],
            ["strikeThrough", "Strikethrough", "S"],
            ["insertUnorderedList", "Bullet list", "• List"],
            ["insertOrderedList", "Numbered list", "1. List"],
          ] as const
        ).map(([cmd, name, text]) => (
          <button
            type="button"
            className="button small"
            aria-label={name}
            title={name}
            key={cmd}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => command(cmd)}
          >
            {text}
          </button>
        ))}
        <button
          type="button"
          className="button small"
          disabled={disabled}
          onMouseDown={(e) => {
            e.preventDefault();
            const s = window.getSelection();
            saved.current = s?.rangeCount ? s.getRangeAt(0).cloneRange() : null;
          }}
          onClick={() => setLink(!link)}
        >
          Link
        </button>
        {onFiles && (
          <label className="button small">
            Attach
            <input
              className="sr-only"
              aria-label="Attach files"
              type="file"
              multiple
              disabled={disabled}
              onChange={(e) => {
                onFiles(Array.from(e.target.files || []));
                e.currentTarget.value = "";
              }}
            />
          </label>
        )}
      </div>
      {link && (
        <div className="discussion-link-form">
          <input
            aria-label="Link URL"
            placeholder="https://"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button
            type="button"
            className="button"
            disabled={!safeLink(url)}
            onClick={() => {
              ref.current?.focus();
              const s = window.getSelection();
              if (saved.current && s) {
                s.removeAllRanges();
                s.addRange(saved.current);
              }
              command("createLink", safeLink(url)!);
              setLink(false);
              setUrl("");
            }}
          >
            Insert link
          </button>
        </div>
      )}
      <div
        ref={ref}
        role="textbox"
        aria-label={label}
        aria-multiline="true"
        aria-readonly={disabled}
        contentEditable={!disabled}
        suppressContentEditableWarning
        className="discussion-editable"
        onInput={change}
        onKeyUp={() => {
          const s = window.getSelection();
          saved.current = s?.rangeCount ? s.getRangeAt(0).cloneRange() : null;
        }}
        onPaste={(e) => {
          e.preventDefault();
          if (e.clipboardData.files.length && onFiles)
            onFiles(Array.from(e.clipboardData.files));
          else command("insertText", e.clipboardData.getData("text/plain"));
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!disabled && onFiles) onFiles(Array.from(e.dataTransfer.files));
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setQuery(null);
        }}
      />
      {query !== null && !disabled && (
        <div
          className="mention-menu"
          role="group"
          aria-label="Mention people or groups"
        >
          {people
            .filter((p) =>
              p.display_name.toLowerCase().includes(query.toLowerCase()),
            )
            .slice(0, 10)
            .map((p) => (
              <button
                type="button"
                key={p.user_id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p.user_id, p.display_name, false)}
              >
                {p.display_name}
                {p.unavailable ? " · Unavailable" : ""}
              </button>
            ))}
          {groups
            .filter((g) => g.includes(query.toLowerCase()))
            .map((g) => (
              <button
                type="button"
                key={g}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(g, g, true)}
              >
                @{g}
              </button>
            ))}
        </div>
      )}
      <small className="muted">
        {onMention && "Type @ to mention people who can read this thread. "}
        {onFiles
          ? "Select or drop up to 10 photos or files. Up to 25 MB each. HEIC originals can be downloaded; use JPEG or PNG for browser previews."
          : "Use the toolbar to format your text."}
      </small>
    </div>
  );
}
