"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  type CollaborationSnapshot,
  type DiscussionPost,
  type DiscussionThread,
  discussionFileMaxBytes,
  discussionFileMaxCount,
  reactions,
  reactionLabels,
} from "@/lib/collaboration";
import type { Project, Task } from "@/lib/types";
import type { StudioContext } from "./studio";
import { Field, Modal, Badge } from "./ui";
import { DiscussionText, DiscussionEditor } from "./discussion-editor";
import { DiscussionFiles, uploadDiscussionFiles } from "./discussion-files";

export function Discussions({
  ctx,
  project,
  task,
}: {
  ctx: StudioContext;
  project: Project;
  task?: Task;
}) {
  const [selected, setSelected] = useState<string | null>(() =>
    !task && typeof window !== "undefined"
      ? new URLSearchParams(location.search).get("discussion")
      : null,
  );
  const [snapshot, setSnapshot] = useState<CollaborationSnapshot | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [uploadProgress, setUploadProgress] = useState(""),
    [loading, setLoading] = useState(true);
  const [before, setBefore] = useState<string | null>(null),
    [offset, setOffset] = useState(0),
    [search, setSearch] = useState(""),
    [sort, setSort] = useState("activity"),
    [trash, setTrash] = useState(false);
  const [creating, setCreating] = useState(false),
    [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [hidden, setHidden] = useState(ctx.workspace.role !== "client");
  const [draft, setDraft] = useState(""),
    [edit, setEdit] = useState<DiscussionPost | null>(null),
    [reply, setReply] = useState<DiscussionPost | null>(null),
    [people, setPeople] = useState<string[]>([]),
    [tags, setTags] = useState<string[]>([]),
    [files, setFiles] = useState<File[]>([]),
    [editorKey, setEditorKey] = useState(0);
  const [confirm, setConfirm] = useState<{
      action: string;
      post?: DiscussionPost;
    } | null>(null),
    [transfer, setTransfer] = useState(""),
    [taskTarget, setTaskTarget] = useState(""),
    [taskTitle, setTaskTitle] = useState("");
  const [editThread, setEditThread] = useState(false),
    [reminderMode, setReminderMode] = useState("self"),
    [reminderPeople, setReminderPeople] = useState<string[]>([]),
    [due, setDue] = useState("");
  const [teamName, setTeamName] = useState(""),
    [teamPeople, setTeamPeople] = useState<string[]>([]);
  const sequence = useRef(0),
    typingAt = useRef(0),
    request = useRef(crypto.randomUUID()),
    draftRef = useRef(draft),
    snapshotRef = useRef(snapshot);
  draftRef.current = draft;
  snapshotRef.current = snapshot;
  const readOnly = !!ctx.readOnly,
    guest = ctx.workspace.role === "client";
  const reload = useCallback(async () => {
    const seq = ++sequence.current;
    const params = {
      p_project: project.id,
      p_thread: selected,
      p_task: task?.id || null,
      p_before: before,
      p_offset: offset,
      p_sort: sort,
      p_search: search,
      p_trash: trash,
    };
    const r = await supabase.rpc(
      readOnly ? "preview_client_collaboration" : "collaboration_snapshot",
      readOnly ? { ...params, p_client: ctx.userId } : params,
    );
    if (seq !== sequence.current) return;
    setLoading(false);
    if (r.error) {
      setError(r.error.message);
      setSnapshot(null);
      return;
    }
    setError("");
    setSnapshot(r.data as CollaborationSnapshot);
  }, [project.id, selected, task?.id, before, offset, readOnly, ctx.userId]);
  useEffect(() => {
    setOffset(0);
  }, [sort, search, trash]);
  useEffect(() => {
    setLoading(true);
    void reload();
    return () => {
      sequence.current++;
    };
  }, [reload]);
  useEffect(() => {
    if (!task || readOnly) return;
    let active = true;
    void supabase
      .rpc("collaboration_command", {
        p_action: "ensure_task",
        p_project: project.id,
        p_payload: { task: task.id },
      })
      .then((r) => {
        if (!active) return;
        if (r.error) setError(r.error.message);
        else {
          setSelected(r.data.thread);
          void reload();
        }
      });
    return () => {
      active = false;
    };
  }, [task?.id, project.id, readOnly]);
  useEffect(() => {
    const channel = supabase.channel(
      `discussion:${project.id}:${selected || task?.id || "list"}:${crypto.randomUUID()}`,
    );
    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "discussion_threads",
        filter: `project_id=eq.${project.id}`,
      },
      () => void reload(),
    );
    if (selected) {
      for (const table of [
        "discussion_posts",
        "discussion_presence",
        "discussion_attachments",
      ])
        channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table,
            filter: `thread_id=eq.${selected}`,
          },
          () => void reload(),
        );
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "discussion_reactions" },
        () => void reload(),
      );
    }
    channel.subscribe();
    const timer = setInterval(() => void reload(), 5000); // Recovery for suspended tabs or unavailable Realtime.
    return () => {
      clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [reload, selected, project.id, task?.id]);
  useEffect(() => {
    if (!snapshot?.thread || readOnly || snapshot.thread.deleted_at) return;
    void supabase.rpc("collaboration_command", {
      p_action: "open",
      p_project: project.id,
      p_thread: snapshot.thread.id,
    });
  }, [snapshot?.thread?.id, readOnly, project.id]);
  const clearDraft = () => {
    setDraft("");
    setEdit(null);
    setReply(null);
    setPeople([]);
    setTags([]);
    setFiles([]);
    setEditorKey((k) => k + 1);
    request.current = crypto.randomUUID();
  };
  const open = (id: string | null) => {
    setSelected(id);
    setBefore(null);
    clearDraft();
    if (!task) {
      const u = new URL(location.href);
      if (id) u.searchParams.set("discussion", id);
      else u.searchParams.delete("discussion");
      history.replaceState(history.state, "", u);
    }
  };
  const command = async (
    action: string,
    payload: Record<string, unknown> = {},
    thread = snapshot?.thread?.id || selected,
  ) => {
    if (readOnly) {
      ctx.notify("Client preview is read-only.");
      return null;
    }
    setBusy(true);
    try {
      const r = await supabase.rpc("collaboration_command", {
        p_action: action,
        p_project: project.id,
        p_thread: thread,
        p_payload: payload,
      });
      if (r.error) throw r.error;
      await reload();
      void ctx.refresh();
      return r.data;
    } catch (e) {
      ctx.notify((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const addFiles = (newFiles: File[]) => {
    if (readOnly) return;
    const accepted = newFiles.filter(
      (f) => f.size > 0 && f.size <= discussionFileMaxBytes,
    );
    if (accepted.length !== newFiles.length)
      ctx.notify("Choose nonempty files up to 25 MB each.");
    if (files.length + accepted.length > discussionFileMaxCount) {
      ctx.notify(
        "Attach up to 10 files per comment. Remove a pending file or send another comment.",
      );
      return;
    }
    setFiles((old) => [...old, ...accepted]);
  };
  const name = (id: string) =>
    snapshot?.people.find((p) => p.user_id === id)?.display_name ||
    ctx.data.members.find((p) => p.user_id === id)?.display_name ||
    "Former project member";
  const d = snapshot?.thread,
    manager = !!snapshot?.manager;
  const participants = snapshot?.people || [];
  const threads = (snapshot?.threads || [])
    .filter(
      (t) =>
        !!t.deleted_at === trash &&
        `${t.title} ${t.description}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        (sort === "name"
          ? a.title.localeCompare(b.title)
          : sort === "created"
            ? b.created_at.localeCompare(a.created_at)
            : b.updated_at.localeCompare(a.updated_at)),
    );
  const editable = !readOnly && !project.archived_at && !project.deleted_at;
  const mention = (id: string, group: boolean) =>
    group
      ? setTags((v) => [...new Set([...v, id])])
      : setPeople((v) => [...new Set([...v, id])]);
  return (
    <section
      className="discussion-workspace"
      aria-label={task ? "Task conversation" : "Project discussions"}
    >
      {!task && !d && (
        <>
          <header className="discussion-heading">
            <div>
              <h2>Discussions</h2>
              <p className="muted">
                One topic per thread. Shared conversations are visible to
                invited clients.
              </p>
            </div>
            <button
              type="button"
              className="button primary"
              disabled={!editable}
              onClick={() => {
                setCreating(true);
                setTitle("");
                setDescription("");
                setHidden(!guest);
                request.current = crypto.randomUUID();
              }}
            >
              Start discussion
            </button>
          </header>
          <div className="discussion-filters">
            <input
              aria-label="Search discussions"
              placeholder="Search discussions"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              aria-label="Sort discussions"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="activity">Latest activity</option>
              <option value="name">Name</option>
              <option value="created">Creation date</option>
            </select>
            <button
              className="button"
              aria-pressed={trash}
              onClick={() => setTrash(!trash)}
            >
              {trash ? "Back to discussions" : "Trash"}
            </button>
          </div>
          {trash && (
            <p className="muted">
              Deleted discussions can be restored for 30 days.
            </p>
          )}
          <div className="discussion-thread-list">
            {threads.map((t) => (
              <article className="discussion-thread-card" key={t.id}>
                <div>
                  <button className="text-button" onClick={() => open(t.id)}>
                    {t.title}
                  </button>
                  <p className="muted">
                    {name(t.created_by)} ·{" "}
                    {new Date(t.updated_at).toLocaleString()}
                  </p>
                </div>
                <div>
                  {t.pinned && <Badge>Pinned</Badge>}
                  <Badge>
                    {t.hidden_from_clients
                      ? "Hidden from clients"
                      : "Shared with clients"}
                  </Badge>
                  {t.deleted_at && <Badge>In Trash</Badge>}
                </div>
              </article>
            ))}
          </div>
          {!loading && !threads.length && (
            <p>
              {trash ? "No deleted discussions." : "No discussions here yet."}
            </p>
          )}
          <div className="toolbar">
            <button
              className="button"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 100))}
            >
              Previous discussions
            </button>
            {snapshot?.has_more_threads && (
              <button
                className="button"
                onClick={() => setOffset(offset + 100)}
              >
                More discussions
              </button>
            )}
          </div>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {loading && <p>Loading conversation…</p>}
      {task && !d && !loading && !error && (
        <p>No comments yet.{readOnly ? " This preview is read-only." : ""}</p>
      )}
      {d && (
        <>
          <header className="discussion-heading">
            <div>
              {!task && (
                <button className="text-button" onClick={() => open(null)}>
                  All discussions
                </button>
              )}
              <h2>{task ? "Conversation" : d.title}</h2>
              <Badge>
                {d.hidden_from_clients
                  ? "Hidden from clients"
                  : "Shared with clients"}
              </Badge>
              {readOnly && <Badge>Read-only preview</Badge>}
              {d.pinned && <Badge>Pinned</Badge>}
            </div>
            <div className="toolbar-right">
              {editable && !d.deleted_at && (
                <button
                  className="button"
                  onClick={() =>
                    void command("subscribe", {
                      enabled: !snapshot!.subscribers.includes(ctx.userId),
                    })
                  }
                >
                  {snapshot!.subscribers.includes(ctx.userId)
                    ? "Unsubscribe"
                    : "Subscribe"}
                </button>
              )}
              {editable &&
                !task &&
                !d.deleted_at &&
                (manager || d.created_by === ctx.userId) && (
                  <button
                    className="button"
                    onClick={() => {
                      setTitle(d.title);
                      setDescription(d.description);
                      setHidden(d.hidden_from_clients);
                      setEditThread(true);
                    }}
                  >
                    Edit discussion
                  </button>
                )}
            </div>
          </header>
          {d.deleted_at ? (
            <div>
              <p>
                This discussion is in Trash. It can be restored within 30 days
                of deletion.
              </p>
              {editable && (manager || d.created_by === ctx.userId) && (
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => void command("restore")}
                >
                  Restore discussion
                </button>
              )}
            </div>
          ) : (
            <>
              {!task && d.description && (
                <DiscussionText text={d.description} />
              )}
              <DiscussionFiles
                files={snapshot!.attachments.filter((f) => !f.post_id)}
                ctx={ctx}
                canRemove={(f) => manager || f.created_by === ctx.userId}
                onChange={() => void reload()}
              />
              <div className="discussion-posts" aria-label="Comments">
                {snapshot!.has_more_posts && (
                  <button
                    className="button"
                    onClick={() =>
                      setBefore(snapshot!.posts.at(-1)?.id || null)
                    }
                  >
                    Earlier comments
                  </button>
                )}
                {before && (
                  <button className="button" onClick={() => setBefore(null)}>
                    Latest comments
                  </button>
                )}
                {[...snapshot!.posts].reverse().map((c) => (
                  <article
                    className="discussion-post"
                    key={c.id}
                    id={`comment-${c.id}`}
                  >
                    <header>
                      <strong>{name(c.created_by)}</strong>
                      <time dateTime={c.created_at}>
                        {new Date(c.created_at).toLocaleString()}
                      </time>
                      {c.edited_at && <small>Edited</small>}
                    </header>
                    {c.reply_to && (
                      <blockquote className="discussion-reply-quote">
                        Reply to{" "}
                        {name(
                          snapshot!.posts.find((p) => p.id === c.reply_to)
                            ?.created_by || "",
                        )}
                        <p>
                          {snapshot!.posts
                            .find((p) => p.id === c.reply_to)
                            ?.body.slice(0, 200) || "An earlier comment"}
                        </p>
                      </blockquote>
                    )}
                    <DiscussionText text={c.body} />
                    {!!c.mentions.length && (
                      <p className="muted">
                        Mentioned:{" "}
                        {c.mentions.map((id) => "@" + name(id)).join(", ")}
                      </p>
                    )}
                    <DiscussionFiles
                      files={snapshot!.attachments.filter(
                        (f) => f.post_id === c.id,
                      )}
                      ctx={ctx}
                      canRemove={(f) =>
                        manager || (f.created_by === ctx.userId && c.can_edit)
                      }
                      onChange={() => void reload()}
                    />
                    <div className="discussion-reactions">
                      {reactions.map((emoji, i) => {
                        const users = snapshot!.reactions
                          .filter(
                            (r) => r.post_id === c.id && r.emoji === emoji,
                          )
                          .map((r) => r.user_id);
                        return users.length ? (
                          <button
                            className="button small"
                            key={emoji}
                            title={users.map(name).join(", ")}
                            aria-label={`${reactionLabels[i]}: ${users.map(name).join(", ")}`}
                            aria-pressed={users.includes(ctx.userId)}
                            disabled={!editable || busy}
                            onClick={() =>
                              void command("react", { post: c.id, emoji })
                            }
                          >
                            {emoji} {users.length}
                          </button>
                        ) : null;
                      })}
                    </div>
                    {editable && (
                      <div className="discussion-post-actions">
                        <button
                          className="button small"
                          onClick={() => {
                            setReply(c);
                            setEdit(null);
                          }}
                        >
                          Reply
                        </button>
                        <details>
                          <summary>React</summary>
                          <div className="discussion-reactions">
                            {reactions.map((emoji, i) => (
                              <button
                                className="button small"
                                key={emoji}
                                aria-label={reactionLabels[i]}
                                disabled={busy}
                                onClick={() =>
                                  void command("react", { post: c.id, emoji })
                                }
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        </details>
                        {c.can_edit && (
                          <>
                            <button
                              className="button small"
                              onClick={() => {
                                setEdit(c);
                                setReply(null);
                                setDraft(c.body);
                                setPeople(
                                  c.mentions.filter((id) =>
                                    participants.some((p) => p.user_id === id),
                                  ),
                                );
                                setTags(c.mention_tags);
                                setEditorKey((k) => k + 1);
                                setFiles([]);
                              }}
                            >
                              Edit comment
                            </button>
                            <button
                              className="button small"
                              onClick={() =>
                                setConfirm({ action: "delete_post", post: c })
                              }
                            >
                              Delete comment
                            </button>
                          </>
                        )}
                        {manager && (
                          <>
                            <button
                              className="button small"
                              onClick={() => {
                                setTaskTitle(c.body.slice(0, 100));
                                setConfirm({ action: "comment_task", post: c });
                              }}
                            >
                              Turn into task
                            </button>
                            <button
                              className="button small"
                              onClick={() => {
                                setTaskTarget("");
                                setConfirm({ action: "append_task", post: c });
                              }}
                            >
                              Append to task
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </article>
                ))}
                {!snapshot!.posts.length && <p>No comments yet.</p>}
              </div>
              <form
                className="discussion-compose"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!editable || (!draft.trim() && !files.length)) return;
                  const r = await command(edit ? "edit_post" : "post", {
                    body: draft.trim() || "Attached files.",
                    people,
                    tags,
                    post: edit?.id,
                    reply_to: reply?.id || null,
                    request: request.current,
                  });
                  if (!r) return;
                  const post = edit?.id || r.post;
                  if (files.length) {
                    setBusy(true);
                    const failed = await uploadDiscussionFiles(
                      d.id,
                      post,
                      files,
                      setUploadProgress,
                    );
                    setBusy(false);
                    if (failed.length) {
                      ctx.notify(
                        "Comment saved. Some files failed: " +
                          failed
                            .map((x) => `${x.file.name}: ${x.error}`)
                            .join("; "),
                      );
                      setEdit({
                        ...((edit ||
                          snapshot!.posts.find((c) => c.id === post)) ?? {
                          id: post,
                          body: draft,
                          mentions: people,
                          mention_tags: tags,
                          thread_id: d.id,
                          created_by: ctx.userId,
                          created_at: new Date().toISOString(),
                          edited_at: null,
                          reply_to: reply?.id || null,
                          can_edit: true,
                        }),
                      });
                      setFiles(
                        files.filter((f) => failed.some((x) => x.file === f)),
                      );
                      await reload();
                      return;
                    }
                  }
                  clearDraft();
                  setBefore(null);
                  await reload();
                }}
              >
                <h3>
                  {edit ? "Edit comment" : reply ? "Reply" : "Add a comment"}
                </h3>
                {reply && (
                  <blockquote>
                    {reply.body.slice(0, 250)}{" "}
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setReply(null)}
                    >
                      Cancel reply
                    </button>
                  </blockquote>
                )}
                <DiscussionEditor
                  label={edit ? "Edit comment" : "Comment"}
                  initial={edit?.body || ""}
                  resetKey={editorKey}
                  onChange={setDraft}
                  people={participants}
                  teams={snapshot!.teams}
                  onMention={mention}
                  disabled={!editable || busy}
                  onFiles={addFiles}
                  onTyping={() => {
                    if (!editable || Date.now() - typingAt.current < 3000)
                      return;
                    typingAt.current = Date.now();
                    void supabase.rpc("collaboration_command", {
                      p_action: "typing",
                      p_project: project.id,
                      p_thread: d.id,
                      p_payload: { active: !!draftRef.current.trim() },
                    });
                  }}
                />
                <div className="discussion-mention-chips">
                  {people.map((id) => (
                    <button
                      type="button"
                      className="button small"
                      key={id}
                      disabled={!editable}
                      onClick={() =>
                        setPeople((v) => v.filter((x) => x !== id))
                      }
                    >
                      @{name(id)} ×
                    </button>
                  ))}
                  {tags.map((tag) => (
                    <button
                      type="button"
                      className="button small"
                      key={tag}
                      disabled={!editable}
                      onClick={() => setTags((v) => v.filter((x) => x !== tag))}
                    >
                      @{tag} ×
                    </button>
                  ))}
                </div>
                {uploadProgress && <p role="status">{uploadProgress}</p>}
                {files.map((f, i) => (
                  <div key={`${f.name}-${i}`}>
                    {f.name}{" "}
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy || !editable}
                      onClick={() =>
                        setFiles((old) => old.filter((_, n) => n !== i))
                      }
                    >
                      Remove pending file
                    </button>
                  </div>
                ))}
                <div className="toolbar">
                  <button
                    className="button primary"
                    disabled={
                      !editable || busy || (!draft.trim() && !files.length)
                    }
                  >
                    {busy ? "Saving…" : edit ? "Save comment" : "Post comment"}
                  </button>
                  {edit && (
                    <button
                      type="button"
                      className="button"
                      onClick={clearDraft}
                    >
                      Cancel edit
                    </button>
                  )}
                </div>
                <p className="muted">
                  {snapshot!.edit_minutes === null
                    ? "You can edit your own comments without a time limit."
                    : `You can edit your own comments for ${snapshot!.edit_minutes} minutes after posting.`}
                </p>
                <p className="discussion-typing" role="status">
                  {snapshot!.typing.length
                    ? snapshot!.typing.map(name).join(", ") + " typing…"
                    : ""}
                </p>
              </form>
              <details className="discussion-controls">
                <summary>Subscribers and reminders</summary>
                <h3>Subscribers</h3>
                <p className="muted">
                  Subscribers receive in-app updates. Email delivery follows
                  each person's notification preference.
                </p>
                {participants.map((p) => (
                  <label className="sharing-choice" key={p.user_id}>
                    <input
                      type="checkbox"
                      checked={snapshot!.subscribers.includes(p.user_id)}
                      disabled={
                        !editable ||
                        busy ||
                        (!manager && p.user_id !== ctx.userId)
                      }
                      onChange={(e) =>
                        void command("subscribe", {
                          user: p.user_id,
                          enabled: e.target.checked,
                        })
                      }
                    />
                    {p.display_name}
                    {p.unavailable ? " · Unavailable" : ""}
                  </label>
                ))}
                {editable && (
                  <form
                    className="settings-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const recipients =
                        reminderMode === "self"
                          ? [ctx.userId]
                          : reminderMode === "subscribers"
                            ? snapshot!.subscribers
                            : reminderPeople;
                      const r = await command("reminder", {
                        people: recipients,
                        due: new Date(due).toISOString(),
                      });
                      if (r) {
                        setDue("");
                        ctx.notify("Reminder scheduled");
                      }
                    }}
                  >
                    <h3>Set a reminder</h3>
                    <Field label="Remind">
                      <select
                        value={reminderMode}
                        onChange={(e) => setReminderMode(e.target.value)}
                      >
                        <option value="self">Just me</option>
                        {!guest && (
                          <>
                            <option value="subscribers">Subscribers</option>
                            <option value="custom">Choose people</option>
                          </>
                        )}
                      </select>
                    </Field>
                    {reminderMode === "custom" &&
                      participants.map((p) => (
                        <label key={p.user_id}>
                          <input
                            type="checkbox"
                            checked={reminderPeople.includes(p.user_id)}
                            onChange={(e) =>
                              setReminderPeople((v) =>
                                e.target.checked
                                  ? [...v, p.user_id]
                                  : v.filter((x) => x !== p.user_id),
                              )
                            }
                          />
                          {p.display_name}
                        </label>
                      ))}
                    <Field label="Reminder date and time">
                      <input
                        type="datetime-local"
                        required
                        value={due}
                        onChange={(e) => setDue(e.target.value)}
                      />
                    </Field>
                    <button className="button" disabled={busy}>
                      Schedule reminder
                    </button>
                  </form>
                )}
                {snapshot!.reminders.map((r) => (
                  <p key={r.id}>
                    {new Date(r.due_at).toLocaleString()} ·{" "}
                    {r.sent_at ? "Sent" : "Scheduled"}{" "}
                    {!r.sent_at && editable && (
                      <button
                        className="text-button"
                        onClick={() =>
                          void command("cancel_reminder", { id: r.id })
                        }
                      >
                        Cancel reminder
                      </button>
                    )}
                  </p>
                ))}
              </details>
              {manager && !readOnly && (
                <details className="discussion-controls">
                  <summary>Manage discussion</summary>
                  <div className="toolbar">
                    <button
                      className="button"
                      disabled={busy || !editable}
                      onClick={() => void command("pin")}
                    >
                      {d.pinned ? "Unpin" : "Pin discussion"}
                    </button>
                    {!task && (
                      <>
                        <button
                          className="button"
                          disabled={!editable}
                          onClick={() => setConfirm({ action: "convert" })}
                        >
                          Convert to task
                        </button>
                        <button
                          className="button"
                          disabled={!editable}
                          onClick={() => {
                            setTransfer("");
                            setConfirm({ action: "move" });
                          }}
                        >
                          Move to project
                        </button>
                        <button
                          className="button"
                          disabled={!editable}
                          onClick={() => {
                            setTransfer("");
                            setConfirm({ action: "copy" });
                          }}
                        >
                          Copy to project
                        </button>
                      </>
                    )}
                  </div>
                  <h3>Access log</h3>
                  {snapshot!.views.length ? (
                    <ul>
                      {snapshot!.views.map((v) => (
                        <li key={v.user_id}>
                          {name(v.user_id)} · Last opened{" "}
                          {new Date(v.last_opened_at).toLocaleString()} ·{" "}
                          {v.open_count} visits
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No recorded opens yet.</p>
                  )}
                </details>
              )}
              {!task &&
                editable &&
                (manager || d.created_by === ctx.userId) && (
                  <button
                    className="button"
                    onClick={() => setConfirm({ action: "delete" })}
                  >
                    Move discussion to Trash
                  </button>
                )}
            </>
          )}
        </>
      )}
      {!task && manager && !readOnly && (
        <details className="discussion-controls">
          <summary>Discussion settings</summary>
          {ctx.workspace.role === "owner" && (
            <Field label="Comment editing window">
              <select
                value={snapshot?.edit_minutes ?? "never"}
                onChange={(e) =>
                  void command("settings", {
                    minutes:
                      e.target.value === "never"
                        ? null
                        : Number(e.target.value),
                  })
                }
              >
                <option value="30">30 minutes</option>
                <option value="60">1 hour</option>
                <option value="1440">1 day</option>
                <option value="10080">7 days</option>
                <option value="never">No expiry</option>
              </select>
            </Field>
          )}
          <form
            className="settings-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await command("team", { name: teamName, people: teamPeople })
              ) {
                setTeamName("");
                setTeamPeople([]);
              }
            }}
          >
            <h3>Project mention teams</h3>
            <p className="muted">
              A mention team includes only people already on this project. Its
              mentions are filtered again by thread visibility.
            </p>
            <Field label="Team mention name">
              <input
                value={teamName}
                pattern="[A-Za-z][A-Za-z0-9_-]{1,39}"
                required
                maxLength={40}
                placeholder="design"
                onChange={(e) => setTeamName(e.target.value)}
              />
            </Field>
            {participants.map((p) => (
              <label className="sharing-choice" key={p.user_id}>
                <input
                  type="checkbox"
                  checked={teamPeople.includes(p.user_id)}
                  onChange={(e) =>
                    setTeamPeople((v) =>
                      e.target.checked
                        ? [...v, p.user_id]
                        : v.filter((x) => x !== p.user_id),
                    )
                  }
                />
                {p.display_name}
              </label>
            ))}
            <button className="button" disabled={busy}>
              Save mention team
            </button>
            {snapshot?.teams.map((t) => (
              <button
                className="text-button"
                type="button"
                key={t.name}
                onClick={() => {
                  setTeamName(t.name);
                  setTeamPeople(t.user_ids);
                }}
              >
                @team:{t.name}
              </button>
            ))}
          </form>
        </details>
      )}
      <Modal
        open={creating || editThread}
        title={editThread ? "Edit discussion" : "Start discussion"}
        onClose={() => {
          setCreating(false);
          setEditThread(false);
        }}
      >
        <form
          className="settings-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await command(editThread ? "edit_thread" : "create", {
              title,
              description,
              hidden,
              request: request.current,
            });
            if (r) {
              setCreating(false);
              setEditThread(false);
              open(r.thread);
            }
          }}
        >
          <Field label="Discussion title">
            <input
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label="Description (optional)">
            <DiscussionEditor
              label="Discussion description"
              initial={description}
              resetKey={creating ? "create" : d?.id || "edit"}
              onChange={setDescription}
            />
          </Field>
          {!guest && (
            <label className="sharing-choice">
              <input
                type="checkbox"
                checked={hidden}
                disabled={!manager}
                onChange={(e) => setHidden(e.target.checked)}
              />
              Hidden from clients
            </label>
          )}
          <p className="muted">
            {hidden
              ? "Only the project team can read this thread. Clients cannot be mentioned until it is shared."
              : "Invited clients can read this discussion and participate."}
          </p>
          <button className="button primary" disabled={busy || !editable}>
            {editThread ? "Save discussion" : "Create discussion"}
          </button>
        </form>
      </Modal>
      <Modal
        open={!!confirm}
        title={
          {
            delete: "Move discussion to Trash?",
            delete_post: "Delete comment?",
            convert: "Convert discussion to task?",
            move: "Move discussion",
            copy: "Copy discussion",
            comment_task: "Turn comment into a task",
            append_task: "Append comment to task",
          }[confirm?.action || ""] || "Confirm action"
        }
        onClose={() => setConfirm(null)}
      >
        <form
          className="settings-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!confirm) return;
            const r = await command(confirm.action, {
              post: confirm.post?.id,
              project: transfer || undefined,
              task: taskTarget || undefined,
              title: taskTitle || undefined,
            });
            if (!r) return;
            setConfirm(null);
            if (r.task) {
              ctx.selectProject(project.id, "Tasks");
              const fresh = await supabase
                .from("tasks")
                .select("*")
                .eq("id", r.task)
                .single();
              if (fresh.data) ctx.openTask(fresh.data);
            } else if (r.project) {
              ctx.selectProject(r.project, "Discussions");
              open(null);
            } else if (confirm.action === "delete") {
              open(null);
              setTrash(true);
            }
          }}
        >
          {confirm?.action === "delete" && (
            <p>
              The discussion and its comments remain recoverable for 30 days.
            </p>
          )}
          {confirm?.action === "delete_post" && (
            <p>
              This comment and its attachments will be removed from the
              conversation.
            </p>
          )}
          {confirm?.action === "convert" && (
            <p>
              The task keeps this discussion's comments, files, subscribers, and
              visibility.
            </p>
          )}
          {["move", "copy"].includes(confirm?.action || "") && (
            <>
              <Field label="Destination project">
                <select
                  value={transfer}
                  required
                  onChange={(e) => setTransfer(e.target.value)}
                >
                  <option value="">Choose a project</option>
                  {ctx.data.projects
                    .filter(
                      (p) =>
                        p.id !== project.id && !p.archived_at && !p.deleted_at,
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </Field>
              <p>
                The destination starts Hidden from clients. Only subscribers
                with access to the destination are carried over. Scheduled
                reminders do not move.
              </p>
            </>
          )}
          {confirm?.action === "comment_task" && (
            <Field label="Task title">
              <input
                value={taskTitle}
                maxLength={200}
                required
                onChange={(e) => setTaskTitle(e.target.value)}
              />
            </Field>
          )}
          {confirm?.action === "append_task" && (
            <Field label="Existing task">
              <select
                value={taskTarget}
                required
                onChange={(e) => setTaskTarget(e.target.value)}
              >
                <option value="">Choose a task</option>
                {ctx.data.tasks
                  .filter((t) => t.project_id === project.id)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
              </select>
            </Field>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="button"
              onClick={() => setConfirm(null)}
            >
              Cancel
            </button>
            <button className="button primary" disabled={busy}>
              Confirm
            </button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
