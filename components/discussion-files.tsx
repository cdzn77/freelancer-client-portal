"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  discussionFileMaxBytes,
  type DiscussionFile,
} from "@/lib/collaboration";
import type { StudioContext } from "./studio";
import { PDFPreview } from "./pdf-preview";
import { Modal } from "./ui";
export async function collaborationHeaders() {
  const { data } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${data.session?.access_token}` };
}
export async function uploadDiscussionFiles(
  thread: string,
  post: string | null,
  files: File[],
  onProgress?: (message: string) => void,
) {
  const failed: { file: File; error: string }[] = [];
  for (const [index, file] of files.entries()) {
    try {
      if (!file.size || file.size > discussionFileMaxBytes)
        throw Error("Choose a file up to 25 MB.");
      onProgress?.(`Uploading ${index + 1} of ${files.length}: ${file.name}`);
      const headers = {
        ...(await collaborationHeaders()),
        "Content-Type": "application/json",
      };
      const start = await fetch("/api/collaboration/uploads", {
        method: "POST",
        headers,
        body: JSON.stringify({
          thread,
          post,
          name: file.name,
          size: file.size,
        }),
      });
      const ticket = await start.json();
      if (!start.ok) throw Error(ticket.error);
      const uploaded = await supabase.storage
        .from("collaboration-staging")
        .uploadToSignedUrl(ticket.path, ticket.token, file, {
          contentType: "application/octet-stream",
        });
      if (uploaded.error) throw uploaded.error;
      const finish = await fetch("/api/collaboration/uploads", {
        method: "PUT",
        headers,
        body: JSON.stringify({ blob: ticket.blob }),
      });
      const result = await finish.json();
      if (!finish.ok) throw Error(result.error);
    } catch (e) {
      failed.push({ file, error: (e as Error).message });
    }
  }
  onProgress?.("");
  return failed;
}
export function DiscussionFiles({
  files,
  ctx,
  canRemove,
  onChange,
}: {
  files: DiscussionFile[];
  ctx: StudioContext;
  canRemove: (f: DiscussionFile) => boolean;
  onChange: () => void;
}) {
  const [preview, setPreview] = useState<DiscussionFile | null>(null),
    [url, setUrl] = useState(""),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [page, setPage] = useState(1),
    [remove, setRemove] = useState<DiscussionFile | null>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!preview) return;
    let active = true,
      object = "";
    setError("");
    setUrl("");
    setText("");
    setPage(1);
    void (async () => {
      try {
        const r = await fetch(
          `/api/collaboration/files?id=${preview.id}&format=url`,
          {
            headers: await collaborationHeaders(),
          },
        );
        if (!r.ok) throw Error((await r.json()).error);
        const { url: signed } = await r.json();
        const response = await fetch(signed);
        if (!response.ok) throw Error("Could not open this file. Try again.");
        const blob = await response.blob();
        if (!active) return;
        object = URL.createObjectURL(blob);
        setUrl(object);
        if (preview.mime === "text/plain")
          setText((await blob.text()).slice(0, 100000));
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    })();
    return () => {
      active = false;
      if (object) URL.revokeObjectURL(object);
    };
  }, [preview]);
  return (
    <>
      <div className="discussion-attachments">
        {files.map((f) => (
          <div className="discussion-file" key={f.id}>
            <button
              type="button"
              className="text-button"
              onClick={() => setPreview(f)}
            >
              {f.name}
            </button>
            <small>{Math.max(1, Math.round(f.size / 1024))} KB</small>
            <button
              className="button small"
              type="button"
              onClick={() => setPreview(f)}
            >
              Preview / download
            </button>
            {!ctx.readOnly && canRemove(f) && (
              <button
                type="button"
                className="button small"
                onClick={() => setRemove(f)}
              >
                Remove<span className="sr-only"> {f.name}</span>
              </button>
            )}
          </div>
        ))}
      </div>
      <Modal
        open={!!preview}
        title={preview?.name || "File preview"}
        onClose={() => setPreview(null)}
      >
        {error && <p role="alert">{error}</p>}
        {!error && !url && <p>Opening file…</p>}
        {url && preview && (
          <>
            <a className="button" href={url} download={preview.name}>
              Download
            </a>
            <div className="discussion-file-preview">
              {preview.mime.startsWith("image/") ? (
                <img src={url} alt={preview.name} />
              ) : preview.mime === "application/pdf" ? (
                <>
                  <PDFPreview url={url} page={page} />
                  <div className="toolbar">
                    <button
                      type="button"
                      className="button"
                      disabled={page <= 1}
                      onClick={() => setPage(page - 1)}
                    >
                      Previous page
                    </button>
                    <label>
                      Page{" "}
                      <input
                        aria-label="PDF page"
                        type="number"
                        min="1"
                        value={page}
                        onChange={(e) =>
                          setPage(Math.max(1, Number(e.target.value) || 1))
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="button"
                      onClick={() => setPage(page + 1)}
                    >
                      Next page
                    </button>
                  </div>
                </>
              ) : preview.mime.startsWith("video/") ? (
                <video controls src={url} />
              ) : preview.mime.startsWith("audio/") ? (
                <audio controls src={url} />
              ) : preview.mime === "text/plain" ? (
                <pre>{text}</pre>
              ) : (
                <p>
                  This file type can be downloaded and opened in its own
                  application.
                </p>
              )}
            </div>
          </>
        )}
      </Modal>
      <Modal
        open={!!remove}
        title="Remove attachment?"
        description="This removes the attachment from this conversation. Copies in other threads are kept."
        onClose={() => setRemove(null)}
      >
        <div className="modal-actions">
          <button className="button" onClick={() => setRemove(null)}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={async () => {
              if (!remove || ctx.readOnly) return;
              setBusy(true);
              try {
                const r = await fetch(
                  `/api/collaboration/files?id=${remove.id}`,
                  { method: "DELETE", headers: await collaborationHeaders() },
                );
                const b = await r.json();
                if (!r.ok) throw Error(b.error);
                setRemove(null);
                onChange();
              } catch (e) {
                ctx.notify((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Remove attachment
          </button>
        </div>
      </Modal>
    </>
  );
}
