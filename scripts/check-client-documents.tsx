import React from "react";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { renderToBuffer } from "@react-pdf/renderer";
import { ClientDocumentPDF } from "../components/client-document-pdf";
import {
  contentSchema,
  documentKinds,
  totals,
  type ClientDocument,
} from "../lib/client-documents";
import { services } from "../lib/service-catalog";
import { documentTemplate, updateGeneratedWording } from "../lib/document-templates";
async function main() {
  for (const service of services)
    for (const kind of documentKinds) {
      const previous = documentTemplate(services[0].name, "Estimate");
  const next = documentTemplate(services[1].name, "Creative brief");
  const changed = updateGeneratedWording({...previous, scope: "Custom client strategy"}, previous, next);
  assert.equal(changed.scope, "Custom client strategy");
  assert.equal(changed.title, next.title);
  assert.equal(changed.deliverables, next.deliverables);
  assert.ok(next.scope.includes("AUDIENCE & COMPETITION"));
  assert.ok(documentTemplate(services[1].name, "Change order").scope.includes("REASON FOR CHANGE"));
  assert.ok(documentTemplate(services[1].name, "Invoice").scope.includes("PAYMENT DUE"));
  const t = documentTemplate(service.name, kind);
      assert.ok(t.scope.length > 20 && t.deliverables.length > 20);
      assert.ok(!JSON.stringify(t).includes("\u2014"), "Generated document copy must not contain em dashes");
      assert.ok(t.terms.includes("50%"));
    }
  const t = documentTemplate(services[1].name, "Project agreement");
  const content = contentSchema.parse({
    business: "Example Studio – Alex Freelancer",
    client: "Example Client — PDF test only",
    email: "client@example.invalid",
    service: services[1].name,
    start: "2026-10-10",
    end: "2026-11-10",
    scope: t.scope,
    deliverables: t.deliverables,
    terms: t.terms,
    tax_note: "Example digital-services tax treatment. Test fixture only.",
    tax_rate: 0,
    items: [
      {
        description: "Responsive website design and handoff",
        quantity: 1,
        unit_cents: 125001,
      },
      { description: "Interactive prototype", quantity: 1, unit_cents: 45000 },
    ],
  });
  const d: ClientDocument = {
    id: "bc000000-0000-4000-8000-000000000099",
    workspace_id: "bc000000-0000-4000-8000-000000000004",
    project_id: null,
    client_id: null,
    kind: "Project agreement",
    title: "Website design agreement — sample",
    version: 2,
    status: "Approved",
    content,
    total_cents: totals(content).total,
    deposit_cents: totals(content).deposit,
    signature_name: "Example Signer (test fixture)",
    decided_at: "2026-09-30T23:00:00Z",
    decision_note: "Approved test fixture, not a real signature.",
    created_at: "2026-09-30T22:00:00Z",
  };
  assert.equal(d.deposit_cents, 85001);
  const pdf = await renderToBuffer(<ClientDocumentPDF document={d} />);
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  await writeFile("/tmp/portal-agreement-sample.pdf", pdf);
  const long = {
    ...d,
    content: {
      ...content,
      scope: Array(80)
        .fill(
          "Long scope test: responsive layouts, interaction states, accessible navigation, design review, and developer handoff.",
        )
        .join("\n"),
      items: Array.from({ length: 25 }, (_, i) => ({
        description: `Deliverable ${i + 1}: ${"Detailed digital design deliverable. ".repeat(8)}`,
        quantity: 1,
        unit_cents: 10000,
      })),
    },
  };
  await writeFile(
    "/tmp/portal-agreement-long-test.pdf",
    await renderToBuffer(<ClientDocumentPDF document={long} />),
  );
  console.log(
    "PASS: all 36 service/document templates, required fields, exact 50% deposit, standard and long PDF rendering.",
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
