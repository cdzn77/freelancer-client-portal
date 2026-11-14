"use client";
import { brand } from "../lib/brand";

import { DocumentTemplateChooser } from "./document-template-chooser";
import { useState } from "react";
import { DocumentEditor } from "./client-documents";
import type { StudioContext } from "./studio";
import { documentKinds, type ClientDocument } from "@/lib/client-documents";
import { ArrowLeft } from "lucide-react";
export function DocumentsPreview() {
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState<ClientDocument["kind"]>("Estimate");
  const [message, setMessage] = useState("");
  function returnToPortal() {
    if (
      editing &&
      !window.confirm("Leave the editor? Any unsaved changes will be lost.")
    )
      return;
    window.location.assign("/");
  }
  const ctx = {
    userId: "preview-admin",
    data: { members: [], projects: [] },
  } as unknown as StudioContext;
  return (
    <main className="public-intake documents-preview" data-no-auto-tooltip>
      <div className="eyebrow">LOCAL PREVIEW · NOTHING IS SAVED OR SENT</div>
      <nav className="document-return-nav" aria-label="Document navigation">
        <button type="button" className="button" onClick={returnToPortal}>
          <ArrowLeft size={16} aria-hidden="true" /> Return to client portal
        </button>
      </nav>
      <div className="page-heading">
        <div>
          <h1>Documents & payments.</h1>
          <p>From the first conversation to the final handoff.</p>
        </div>
      </div>
      {editing ? (
        <>
          <button className="button" onClick={() => setEditing(false)}>
            <ArrowLeft size={16} /> All templates
          </button>
          <DocumentEditor
            ctx={ctx}
            source={null}
            initialKind={kind}
            busy={false}
            onReturn={returnToPortal}
            cancel={() => setEditing(false)}
            save={async () => {
              setMessage("Preview complete. No document was saved or sent.");
              setEditing(false);
            }}
          />
        </>
      ) : (
        <>
          {message && <p role="status">{message}</p>}
          <h2>Define the next step.</h2>
          <DocumentTemplateChooser
            onSelect={(k) => {
              setKind(k);
              setEditing(true);
            }}
          />
          <p className="document-preview-note">
            Client approval, payment connections, and saving use your
            authenticated workspace. This preview lets you explore the editor.
          </p>
        </>
      )}
    </main>
  );
}
