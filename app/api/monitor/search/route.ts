
import { brand } from "../../../../lib/brand";
import { refreshChronicles } from "@/lib/chronicles-provider";
import { z } from "zod";
import { refreshCrawl } from "@/lib/monitor-crawl";
import { exactPage, changeStage } from "@/lib/monitor-intelligence";
import { requestClient } from "@/lib/server";
import { monitorClient, monitorWorkspace } from "@/lib/website-monitor";
import { refreshSearch, autocomplete } from "@/lib/search-providers";
import { brandEvidence } from "@/lib/search-intelligence";
const path = z
  .string()
  .max(500)
  .refine(
    (v) => /^\/(?!\/)/.test(v) && !/[\\\r\n]/.test(v),
    ("Use a path on " + brand.domain + "."),
  );
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("refresh") }),
  z.object({ action: z.literal("crawl") }),
  z.object({ action: z.literal("chronicles") }),
  z.object({ action: z.literal("chronicles-discovery") }),
  z.object({ action: z.literal("crawl-retest") }),
  z.object({
    action: z.literal("settings"),
    prompts: z.array(z.string().trim().min(10).max(1000)).min(1).max(20),
    competitors: z
      .array(
        z.object({
          name: z.string().trim().min(2).max(100),
          aliases: z.array(z.string().trim().min(2).max(100)).max(10),
        }),
      )
      .max(15),
    inquiry_event: z
      .string()
      .regex(/^[a-zA-Z0-9_]*$/)
      .max(100),
    booking_event: z
      .string()
      .regex(/^[a-zA-Z0-9_]*$/)
      .max(100),
    inquiry_evidence: z.string().max(2000),
    booking_evidence: z.string().max(2000),
  }),
  z.object({
    action: z.literal("change_status"),
    id: z.string().uuid(),
    status: z.enum(["Shipped", "Verified", "Reverted"]),
    verification: z.string().max(4000),
    reference: z.string().max(1000),
  }),
  z.object({
    action: z.literal("discover"),
    seed: z.string().trim().min(2).max(100),
    language: z
      .string()
      .regex(/^[a-z]{2}$/)
      .default("en"),
    country: z
      .string()
      .regex(/^[a-z]{2}$/)
      .default("us"),
  }),
  z.object({
    action: z.literal("keyword"),
    query: z.string().trim().min(2).max(200),
    page: path,
    intent: z.enum(["buyer", "research", "brand"]),
    priority: z.enum(["1", "2", "3"]),
    source: z.enum(["Manual", "Google Autocomplete", "Search Console"]),
    next: z.string().max(2000).default(""),
    approval: z.enum(["Draft", "Approved", "Rejected"]).default("Draft"),
    rationale: z.string().max(2000).default(""),
  }),
  z.object({
    action: z.literal("suggestion"),
    key: z.string().min(1).max(2000),
    title: z.string().min(1).max(2000),
    evidence: z.string().max(4000),
    next: z.string().max(4000),
    state: z.enum(["Open", "Acknowledged", "Snoozed", "Resolved", "Dismissed"]),
    priority: z.enum(["1", "2", "3"]).default("2"),
    effort: z.enum(["Low", "Medium", "High"]).default("Medium"),
    category: z.string().max(100).default("Search"),
    page: z.string().max(2000).default(""),
    confidence: z.string().max(200).default("Observed"),
  }),
  z.object({
    action: z.literal("change"),
    title: z.string().trim().min(3).max(250),
    page: path,
    notes: z.string().max(4000),
  }),
  z.object({
    action: z.literal("answer"),
    engine: z.enum(["ChatGPT", "Claude", "Gemini", "Kimi", "Other"]),
    prompt: z.string().trim().min(3).max(2000),
    answer: z.string().trim().min(3).max(20000),
    citations: z
      .array(
        z
          .string()
          .url()
          .refine((s) => /^https?:\/\//.test(s)),
      )
      .max(30),
    observed_at: z
      .string()
      .datetime()
      .refine(
        (s) => Date.parse(s) <= Date.now(),
        "Observation cannot be in the future.",
      ),
  }),
]);
async function authorized(request: Request, workspace: string | null) {
  const client = await requestClient(request);
  if (!z.string().uuid().safeParse(workspace).success) throw Error("workspace");
  const { data: role, error } = await client.rpc("workspace_role", {
    w: workspace,
  });
  if (error || role !== "owner" || workspace !== monitorWorkspace())
    throw Error("forbidden");
  return client;
}
const response = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(request: Request) {
  const workspace = new URL(request.url).searchParams.get("workspace");
  let client;
  try {
    client = await authorized(request, workspace);
  } catch (e) {
    return response(
      {
        error:
          (e as Error).message === "forbidden"
            ? "Administrator access to the connected workspace is required."
            : "Sign in to the connected workspace.",
      },
      (e as Error).message === "forbidden" ? 403 : 401,
    );
  }
  const { data, error } = await client
    .from("monitor_records")
    .select("id,kind,source_id,title,body,linked_task_id,imported_at")
    .eq("workspace_id", workspace)
    .eq("source", "pms-search")
    .neq("kind", "search_report")
    .order("imported_at", { ascending: false })
    .limit(500);
  const latest = await client
    .from("monitor_records")
    .select("id,kind,source_id,title,body,linked_task_id,imported_at")
    .eq("workspace_id", workspace)
    .eq("source", "pms-search")
    .eq("kind", "search_report")
    .eq("source_id", "current")
    .maybeSingle();
  return error || latest.error
    ? response({ error: "Could not load search intelligence." }, 503)
    : response({
        records: [...(latest.data ? [latest.data] : []), ...(data || [])],
        limit: 500,
      });
}
export async function POST(request: Request) {
  const workspace = new URL(request.url).searchParams.get("workspace");
  let client;
  try {
    client = await authorized(request, workspace);
  } catch (e) {
    return response(
      { error: "Administrator access to the connected workspace is required." },
      (e as Error).message === "forbidden" ? 403 : 401,
    );
  }
  const raw = await request.text();
  if (raw.length > 40000)
    return response({ error: "Request is too large." }, 413);
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return response({ error: "Choose a valid action." }, 400);
  }
  const parsed = bodySchema.safeParse(value);
  if (!parsed.success)
    return response(
      {
        error: parsed.error.issues[0]?.message || "Check the supplied fields.",
      },
      400,
    );
  const input = parsed.data;
  try {
    if (input.action === "refresh") return response(await refreshSearch());
    if (input.action === "chronicles")
      return response(await refreshChronicles());
    if (input.action === "chronicles-discovery")
      return response(await refreshChronicles(true));
    if (input.action === "crawl-retest")
      return response(await refreshCrawl(true));
    if (input.action === "crawl") return response(await refreshCrawl());
    if (input.action === "change_status") {
      const prior = await client
        .from("monitor_records")
        .select("body")
        .eq("workspace_id", workspace)
        .eq("source", "pms-search")
        .eq("kind", "change")
        .eq("id", input.id)
        .single();
      if (prior.error) throw Error("Could not find the change.");
      if (input.status === "Verified") {
        const current = await client
          .from("monitor_records")
          .select("body")
          .eq("workspace_id", workspace)
          .eq("source", "pms-search")
          .eq("kind", "search_report")
          .eq("source_id", "current")
          .single();
        if (
          current.error ||
          !input.verification.trim() ||
          changeStage(
            { ...prior.data.body, status: "Shipped" },
            current.data.body,
          ) !== "Comparable window" ||
          !exactPage(prior.data.body.baseline, prior.data.body.page) ||
          !exactPage(current.data.body, prior.data.body.page)
        )
          return response(
            {
              error:
                "A full post-change window, page measurements and verification evidence are required.",
            },
            400,
          );
      }
      const updated = await client
        .from("monitor_records")
        .update({
          body: {
            ...prior.data.body,
            status: input.status,
            verification: input.verification,
            reference: input.reference,
            verified_at:
              input.status === "Verified" ? new Date().toISOString() : null,
          },
        })
        .eq("workspace_id", workspace)
        .eq("source", "pms-search")
        .eq("kind", "change")
        .eq("id", input.id);
      if (updated.error) throw Error("Could not update the change.");
      return response({ updated: true });
    }
    if (input.action === "discover") {
      const { data: claimed, error } = await monitorClient().rpc(
        "claim_monitor_refresh",
        { w: workspace, k: "autocomplete" },
      );
      if (error || !claimed)
        return response(
          { error: "Wait two minutes before another Autocomplete lookup." },
          429,
        );
      const body = await autocomplete(
        input.seed,
        input.language,
        input.country,
      );
      const saved = await client.from("monitor_records").upsert(
        {
          workspace_id: workspace,
          source: "pms-search",
          kind: "discovery",
          source_id: `${input.language}:${input.country}:${input.seed.toLowerCase()}`,
          title: input.seed,
          body,
          imported_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,source,kind,source_id" },
      );
      if (saved.error) throw Error("Could not save the discovery.");
      return response({ updated: true });
    }
    let body: Record<string, unknown> = { ...input },
      kind: string = input.action,
      id: string = crypto.randomUUID(),
      title: string = "";
    if (input.action === "settings") {
      id = "current";
      title = "Monitor collection settings";
      const previous = await client
        .from("monitor_records")
        .select("body")
        .eq("workspace_id", workspace)
        .eq("source", "pms-search")
        .eq("kind", "settings")
        .eq("source_id", "current")
        .maybeSingle();
      if (previous.error) throw Error("Could not load settings.");
      body = { ...(previous.data?.body || {}), ...input };
    }
    if (input.action === "keyword") {
      id = input.query.toLowerCase();
      title = input.query;
    }
    if (input.action === "suggestion") {
      id = input.key;
      title = input.title;
      body.notes = input.evidence + "\n\n" + input.next;
      body.snoozed_until =
        input.state === "Snoozed"
          ? new Date(Date.now() + 7 * 86400000).toISOString()
          : null;
    }
    if (input.action === "answer") {
      title = input.prompt;
      body = {
        ...input,
        ...brandEvidence(input.answer, input.citations),
        method: "Manual observation",
      };
    }
    if (input.action === "change") {
      title = input.title;
      const { data, error } = await client
        .from("monitor_records")
        .select("body")
        .eq("workspace_id", workspace)
        .eq("source", "pms-search")
        .eq("kind", "search_report")
        .eq("source_id", "current")
        .maybeSingle();
      if (error) throw Error("Could not save the baseline.");
      body = {
        ...input,
        shipped_at: new Date().toISOString(),
        baseline: data?.body || null,
        page_baseline: exactPage(data?.body, input.page) || null,
        status: "Shipped",
      };
    }
    const saved = await client.from("monitor_records").upsert(
      {
        workspace_id: workspace,
        source: "pms-search",
        kind,
        source_id: id,
        title,
        body,
        imported_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,source,kind,source_id" },
    );
    if (saved.error) throw Error("Could not save this record.");
    return response({ updated: true });
  } catch (e) {
    const message = (e as Error).message;
    return response(
      {
        error: /^(Google|Connect|Reconnect|Could not|Website|Choose the)/.test(
          message,
        )
          ? message
          : "The request failed. Saved data is unchanged.",
      },
      503,
    );
  }
}
