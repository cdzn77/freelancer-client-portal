import test from "node:test";
import assert from "node:assert/strict";
import { supabase, database, resetDemo, setDemoRole, demoFetch, demoSession } from "./backend";
import { ownerId, clientId, workspaceId } from "./data";

test("edits affect only in-memory demo records and reset restores the seed", async () => {
  resetDemo(); setDemoRole(false);
  const initial = database.tasks.length;
  const created = await supabase.from("tasks").insert({ title: "Demo test", project_id: database.projects[0].id }).select("id");
  assert.equal(created.error, null);
  assert.equal(database.tasks.length, initial + 1);
  await supabase.from("tasks").update({ status: "Done" }).eq("id", created.data[0].id);
  assert.equal(database.tasks.at(-1)?.status, "Done");
  resetDemo();
  assert.equal(database.tasks.length, initial);
  assert.equal(database.tasks.some(t => t.title === "Demo test"), false);
});

test("role switching uses fictional users and client writes are restricted", async () => {
  setDemoRole(false); assert.equal(demoSession().user.id, ownerId);
  setDemoRole(true); assert.equal(demoSession().user.id, clientId);
  const result = await supabase.from("projects").insert({ name: "Blocked" });
  assert.match(result.error.message, /own installed portal/);
  const membership = await supabase.from("workspace_members").select("workspace_id,role,workspaces(*)").eq("user_id", clientId);
  assert.equal(membership.data[0].role, "client");
  assert.equal(membership.data[0].workspaces.id, workspaceId);
  setDemoRole(false);
});

test("server and external requests never escape the demo adapter", async () => {
  for (const url of ["/api/client-documents", "/api/workspace/members", "https://example.com/collect", "http://127.0.0.1:8000"]) {
    const response = await demoFetch(url, { method: "POST", body: "fictional payload" });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /off in this demo/);
  }
  const documents = await demoFetch("/api/client-documents?workspace=" + workspaceId);
  assert.equal(documents.status, 200);
  assert.equal((await documents.json()).documents.length, 3);
  assert.notEqual((await supabase.rpc("create_workspace")).error, null);
  assert.notEqual((await supabase.auth.updateUser({ password: "unused" })).error, null);
});
