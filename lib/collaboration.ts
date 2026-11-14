export const discussionFileMaxBytes = 25 * 1024 * 1024;
export const discussionFileMaxCount = 10;
export type DiscussionThread = {
  id: string;
  workspace_id: string;
  project_id: string;
  task_id: string | null;
  title: string;
  description: string;
  hidden_from_clients: boolean;
  pinned: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
export type DiscussionPost = {
  id: string;
  thread_id: string;
  body: string;
  created_by: string;
  created_at: string;
  edited_at: string | null;
  reply_to: string | null;
  mentions: string[];
  mention_tags: string[];
  can_edit: boolean;
};
export type DiscussionPerson = {
  user_id: string;
  display_name: string;
  role: "owner" | "member" | "contractor" | "client";
  unavailable: boolean;
};
export type DiscussionFile = {
  id: string;
  thread_id: string;
  post_id: string | null;
  created_by: string;
  name: string;
  mime: string;
  size: number;
};
export type CollaborationSnapshot = {
  threads: DiscussionThread[];
  has_more_threads: boolean;
  thread: DiscussionThread | null;
  people: DiscussionPerson[];
  posts: DiscussionPost[];
  has_more_posts: boolean;
  subscribers: string[];
  reactions: { post_id: string; user_id: string; emoji: string }[];
  attachments: DiscussionFile[];
  typing: string[];
  views: {
    user_id: string;
    first_opened_at: string;
    last_opened_at: string;
    open_count: number;
  }[];
  reminders: {
    id: string;
    created_by: string;
    recipients: string[];
    due_at: string;
    sent_at: string | null;
  }[];
  teams: { name: string; user_ids: string[] }[];
  edit_minutes: number | null;
  manager: boolean;
};
export const reactions = ["👍", "😊", "👏", "❤️", "🎉", "🤔", "👎"];
export const reactionLabels = [
  "Thumbs up",
  "Smile",
  "Applaud",
  "Heart",
  "Celebrate",
  "Think",
  "Thumbs down",
];
export function safeLink(value: string) {
  try {
    const u = new URL(value);
    return ["https:", "http:", "mailto:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}
/** Preview types come from content signatures, never an uploaded HTML/SVG MIME claim. */
export function attachmentMime(bytes: Uint8Array, name: string) {
  const head = Buffer.from(bytes.subarray(0, 32));
  if (head.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (
    head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (head[0] === 255 && head[1] === 216 && head[2] === 255)
    return "image/jpeg";
  if (/^GIF8[79]a/.test(head.toString())) return "image/gif";
  if (
    head.subarray(0, 4).toString() === "RIFF" &&
    head.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  if (
    head.subarray(0, 4).toString() === "RIFF" &&
    head.subarray(8, 12).toString() === "WAVE"
  )
    return "audio/wav";
  if (head.subarray(0, 3).toString() === "ID3") return "audio/mpeg";
  if (
    head.subarray(4, 8).toString() === "ftyp" &&
    /heic|heix|hevc|hevx|mif1|msf1/.test(head.toString())
  )
    return "application/octet-stream";
  if (head.subarray(4, 8).toString() === "ftyp")
    return /\.m4a$/i.test(name) ? "audio/mp4" : "video/mp4";
  if (/\.(txt|md|csv|log)$/i.test(name) && !bytes.includes(0))
    return "text/plain";
  return "application/octet-stream";
}
