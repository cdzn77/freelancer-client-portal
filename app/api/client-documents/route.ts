import { squareCheckoutReady } from "@/lib/square";
import { requestClient } from "@/lib/server";
import { serviceDB } from "@/lib/service-db";
import { documentSchema, totals } from "@/lib/client-documents";
import { z } from "zod";
export async function GET(request: Request) {
  try {
    const db = await requestClient(request);
    const w = new URL(request.url).searchParams.get("workspace");
    if (!z.string().uuid().safeParse(w).success)
      throw Error("Choose a workspace.");
    const [docs, payments, settings, balances] = await Promise.all([
      db
        .from("client_documents")
        .select("*")
        .eq("workspace_id", w)
        .order("created_at", { ascending: false }),
      db.from("client_payments").select("*").eq("workspace_id", w),
      db
        .from("studio_payment_settings")
        .select("*")
        .eq("workspace_id", w)
        .maybeSingle(),
      db.rpc("document_billing_balances", { w }),
    ]);
    if (docs.error || payments.error || settings.error || balances.error)
      throw Error("Documents are unavailable. Please retry.");
    return Response.json(
      {
        documents: docs.data,
        balances: balances.data,
        payments: payments.data,
        settings: settings.data,
        square_ready: squareCheckoutReady(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
export async function POST(request: Request) {
  try {
    const db = await requestClient(request);
    const raw = await request.text();
    if (raw.length > 100000) throw Error("Document is too large.");
    const body = JSON.parse(raw);
    const w = z.string().uuid().parse(body.workspace_id);
    const { data: user } = await db.auth.getUser();
    const { data: member } = await db
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", w)
      .eq("user_id", user.user!.id)
      .single();
    if (member?.role !== "owner")
      return Response.json(
        { error: "Administrator access required." },
        { status: 403 },
      );
    const service = serviceDB();
    if (body.action === "settings") {
      const input = z
        .object({
          cash_app: z.string().max(500),
          venmo: z.string().max(500),
          zelle: z.string().max(500),
        })
        .parse(body);
      const { error } = await service
        .from("studio_payment_settings")
        .upsert({ workspace_id: w, ...input });
      if (error) throw error;
      return Response.json({ ok: true });
    }
    if (body.action === "create") {
      const input = documentSchema.parse(body);
      if (input.client_id) {
        const { data: m } = await service
          .from("workspace_members")
          .select("user_id")
          .eq("workspace_id", w)
          .eq("user_id", input.client_id)
          .maybeSingle();
        if (!m) throw Error("Client must belong to this workspace.");
      }
      if (input.project_id) {
        const { data: p } = await db
          .from("projects")
          .select("id")
          .eq("workspace_id", w)
          .eq("id", input.project_id)
          .is("deleted_at", null)
          .is("archived_at", null)
          .maybeSingle();
        if (!p) throw Error("Choose an active project.");
      }
      if (body.billing_profile_id) {
        const account = z.string().uuid().parse(body.billing_profile_id);
        const r = await db
          .from("billing_profiles")
          .select("*")
          .eq("client_account_id", account)
          .eq("workspace_id", w)
          .single();
        if (
          r.error ||
          !r.data ||
          r.data.revision !== body.billing_profile_revision
        )
          throw Error(
            "Billing profile changed. Apply its current defaults before saving.",
          );
        if (input.project_id) {
          const p = await db
            .from("projects")
            .select("client_account_id")
            .eq("id", input.project_id)
            .single();
          if (p.data?.client_account_id !== account)
            throw Error(
              "Choose the billing profile linked to this project's client.",
            );
        }
        input.content.billing_profile = {
          id: account,
          revision: r.data.revision,
        };
      }
      let version = 1;
      if (input.previous_id) {
        const { data: old } = await db
          .from("client_documents")
          .select("*")
          .eq("id", input.previous_id)
          .eq("workspace_id", w)
          .single();
        if (!old) throw Error("Previous document unavailable.");
        if (
          old.project_id !== input.project_id ||
          old.client_id !== input.client_id ||
          old.kind !== input.kind
        )
          throw Error(
            "A revision must keep the same project, recipient and document type. Create a separate document for a new purpose.",
          );
        version = old.version + 1;
      }
      const { data, error } = await service
        .from("client_documents")
        .insert({
          ...input,
          total_cents: totals(input.content).total,
          version,
          created_by: user.user!.id,
        })
        .select("id")
        .single();
      if (error) throw error;
      return Response.json(data, { status: 201 });
    }
    const id = z.string().uuid().parse(body.id);
    const { data: d } = await db
      .from("client_documents")
      .select("*")
      .eq("id", id)
      .eq("workspace_id", w)
      .single();
    if (!d) throw Error("Document unavailable.");
    if (body.action === "share") {
      if (d.status !== "Draft" || !d.client_id)
        throw Error("Choose a client on a draft before sharing.");
      if (
        /\[(Describe|Define|Confirm)\b|specify before sharing/i.test(
          [d.content.scope, d.content.deliverables].join("\n"),
        )
      )
        throw Error(
          "Complete the template prompts and specific deliverables before sharing.",
        );
      if (d.project_id) {
        const { data: access } = await service
          .from("project_members")
          .select("user_id")
          .eq("project_id", d.project_id)
          .eq("user_id", d.client_id)
          .maybeSingle();
        const { data: m } = await service
          .from("workspace_members")
          .select("role")
          .eq("workspace_id", w)
          .eq("user_id", d.client_id)
          .single();
        if (!access && m?.role !== "owner")
          throw Error("Give the recipient access to this project first.");
      }
      const { error } = await service
        .from("client_documents")
        .update({ status: "Shared", shared_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "Draft");
      if (error) throw error;
      await service.from("studio_notifications").insert({
        workspace_id: w,
        user_id: d.client_id,
        project_id: d.project_id,
        title: "Ready for review: " + d.title,
        event_key: "document-shared:" + id,
      });
    } else if (body.action === "withdraw") {
      if (!["Draft", "Shared", "Discussion"].includes(d.status))
        throw Error("Approved documents are retained. Create a new version.");
      const { error } = await service
        .from("client_documents")
        .update({ status: "Withdrawn" })
        .eq("id", id)
        .in("status", ["Draft", "Shared", "Discussion"]);
      if (error) throw error;
    } else if (body.action === "payment") {
      const p = z
        .object({
          provider: z.enum(["Cash App", "Venmo", "Zelle"]),
          reference: z.string().trim().min(3).max(200),
          amount_cents: z.number().int().positive().max(100000000),
        })
        .parse(body);
      if (d.status !== "Approved")
        throw Error("Approve the document before recording payment.");
      const { error } = await service.from("client_payments").insert({
        workspace_id: w,
        document_id: id,
        provider: p.provider,
        provider_id: p.provider + ":" + p.reference,
        amount_cents: p.amount_cents,
        confirmed_by: user.user!.id,
      });
      if (error)
        throw Error(
          error.code === "23505"
            ? "This payment reference was already recorded."
            : "Could not record payment.",
        );
    } else throw Error("Unknown action.");
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof z.ZodError
            ? "Check the required document fields."
            : (e as Error).message,
      },
      { status: 400 },
    );
  }
}
