"use client";
import { documentKinds, type ClientDocument } from "@/lib/client-documents";
import { FileText, ArrowRight } from "lucide-react";
export function DocumentTemplateChooser({
  onSelect,
}: {
  onSelect: (kind: ClientDocument["kind"]) => void;
}) {
  return (
    <div className="document-template-grid">
      {documentKinds.map((k, i) => (
        <button
          key={k}
          className="document-template-card"
          onClick={() => onSelect(k)}
        >
          <div className="document-template-meta">
            <span>0{i + 1}</span>
            <FileText size={28} strokeWidth={1} />
          </div>
          <h3>{k}</h3>
          <p>
            {
              {
                Estimate:
                  "Translate the brief into a clear scope, investment, and proposed next step.",
                Contract:
                  "Establish how we will work together, with clear responsibilities and terms.",
                "Project agreement":
                  "Align the outcome, approach, milestones, and deliverables before work begins.",
                Invoice:
                  "Present agreed fees, payment milestones, and the balance due.",
                "Creative brief":
                  "Connect the business challenge to the audience, message, and creative direction.",
                "Change order":
                  "Make a change explicit: what is evolving, why, and its effect on cost and timing.",
              }[k]
            }
          </p>
          <span className="document-template-link">Prepare document <ArrowRight size={16} aria-hidden="true" /></span>
        </button>
      ))}
    </div>
  );
}
