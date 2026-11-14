import assert from "node:assert/strict";
import { discussionReply, type ReplyMessage } from "../lib/discussion-email";
import {
  collaborationWorkerSignature,
  validCollaborationWorker,
} from "../lib/collaboration-worker-auth";
import { attachmentMime, safeLink } from "../lib/collaboration";
const token = "ca000000-0000-4000-8000-000000000003";
const message: ReplyMessage = {
  id: "test",
  payload: {
    mimeType: "multipart/mixed",
    headers: [
      { name: "From", value: "Client <client@example.com>" },
      {
        name: "Authentication-Results",
        value: "mx.google.com; dmarc=pass header.from=example.com;",
      },
      { name: "In-Reply-To", value: `<pms-reply-${token}@example.com>` },
    ],
    parts: [
      {
        mimeType: "text/plain",
        body: {
          data: Buffer.from(
            "Approved.\n\nOn Monday Someone wrote:\n> older private content",
          ).toString("base64url"),
        },
      },
      {
        partId: "1",
        filename: "proof.png",
        mimeType: "image/png",
        body: { attachmentId: "file", size: 100 },
      },
    ],
  },
};
assert.equal(discussionReply(message)?.body, "Approved.");
assert.equal(discussionReply(message)?.files.length, 1);
for (const extra of [
  { name: "Auto-Submitted", value: "auto-replied" },
  { name: "Precedence", value: "bulk" },
  { name: "List-Id", value: "mailing-list" },
  { name: "From", value: "attacker@example.org" },
])
  assert.equal(
    discussionReply({
      ...message,
      payload: {
        ...message.payload,
        headers: [...message.payload!.headers!, extra],
      },
    }),
    null,
  );
assert.equal(discussionReply({ ...message, labelIds: ["SPAM"] }), null);
assert.equal(
  discussionReply({
    ...message,
    payload: {
      ...message.payload,
      headers: message.payload!.headers!.filter(
        (h) => h.name !== "Authentication-Results",
      ),
    },
  }),
  null,
);
assert.equal(
  discussionReply({
    ...message,
    payload: {
      ...message.payload,
      headers: message.payload!.headers!.map((h) =>
        h.name === "Authentication-Results"
          ? {
              ...h,
              value:
                "mx.google.com; dmarc=pass header.from=example.com.attacker.org;",
            }
          : h,
      ),
    },
  }),
  null,
);
assert.equal(safeLink("javascript:alert(1)"), null);
assert.equal(
  attachmentMime(Buffer.from("<script>alert(1)</script>"), "fake.png"),
  "application/octet-stream",
);
assert.equal(
  attachmentMime(Buffer.from("%PDF-1.7"), "proof.pdf"),
  "application/pdf",
);
const now = Date.now(),
  stamp = String(now),
  key = "test-only-key";
assert.equal(
  validCollaborationWorker(
    stamp,
    collaborationWorkerSignature(stamp, key),
    key,
    now,
  ),
  true,
);
assert.equal(
  validCollaborationWorker(
    stamp,
    collaborationWorkerSignature(stamp, key),
    "wrong-key",
    now,
  ),
  false,
);
assert.equal(
  validCollaborationWorker(
    stamp,
    collaborationWorkerSignature(stamp, key),
    key,
    now + 61000,
  ),
  false,
);
assert.equal(validCollaborationWorker(stamp, "bad", key, now), false);
console.log(
  "Discussion email authentication, quoting, attachments and worker checks passed.",
);
