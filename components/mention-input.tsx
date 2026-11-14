"use client";
import { useRef, useState, type TextareaHTMLAttributes } from "react";
import type { Member } from "@/lib/types";
/** Review tags are saved as readable text; discussion tags also store existing validated user IDs. */
export function MentionInput({
  people,
  value,
  onValue,
  onMention,
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  people: Member[];
  value?: string;
  onValue?: (value: string) => void;
  onMention?: (id: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(""),
    [query, setQuery] = useState<string | null>(null);
  const text = value ?? draft;
  const update = (v: string) => {
    setDraft(v);
    onValue?.(v);
  };
  const matches =
    query === null
      ? []
      : people
          .filter((p) =>
            p.display_name.toLowerCase().includes(query.toLowerCase()),
          )
          .slice(0, 10);
  return (
    <div className="mention-composer">
      <textarea
        {...props}
        ref={ref}
        value={text}
        onChange={(e) => {
          update(e.target.value);
          const match = e.target.value
            .slice(0, e.target.selectionStart)
            .match(/(?:^|\s)@([^@\n]*)$/);
          setQuery(match?.[1] ?? null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setQuery(null);
          if (e.key === "ArrowDown" && query !== null) {
            e.preventDefault();
            menu.current?.querySelector("button")?.focus();
          }
        }}
      />
      {query !== null && (
        <div
          className="mention-menu"
          ref={menu}
          role="group"
          aria-label="Mention a project participant"
        >
          {matches.length ? (
            matches.map((person) => (
              <button
                type="button"
                key={person.user_id}
                onClick={() => {
                  const field = ref.current;
                  if (!field) return;
                  const cursor = field.selectionStart;
                  const start = text.lastIndexOf("@", cursor - 1);
                  if (start < 0) return;
                  const insert = `@${person.display_name} `;
                  update(text.slice(0, start) + insert + text.slice(cursor));
                  onMention?.(person.user_id);
                  setQuery(null);
                  requestAnimationFrame(() => {
                    field.focus();
                    field.setSelectionRange(
                      start + insert.length,
                      start + insert.length,
                    );
                  });
                }}
              >
                {person.display_name}
                <small>
                  {person.role === "client" ? "Client" : "Studio team"}
                </small>
              </button>
            ))
          ) : (
            <p>No matching project participants.</p>
          )}
        </div>
      )}
      <small className="mention-help">
        Type @ to tag someone with project access. Tags do not change who can
        see this {onMention ? "message" : "feedback"}.
      </small>
    </div>
  );
}
