import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
async function main() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost",
  });
  for (const name of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "HTMLButtonElement",
    "HTMLFormElement",
    "HTMLSelectElement",
    "HTMLInputElement",
    "Element",
    "Node",
    "NodeFilter",
    "DocumentFragment",
    "MutationObserver",
    "Event",
    "CustomEvent",
    "MouseEvent",
    "KeyboardEvent",
    "FocusEvent",
    "getComputedStyle",
  ])
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: (dom.window as any)[name],
    });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.Element.prototype.hasPointerCapture = function () {
    return false;
  };
  dom.window.Element.prototype.setPointerCapture = function () {};
  dom.window.Element.prototype.releasePointerCapture = function () {};
  const React = await import("react");
  const { render, screen, cleanup, within } =
    await import("@testing-library/react");
  const { default: userEvent } = await import("@testing-library/user-event");
  const { DashboardBoard } = await import("../components/dashboard-board");
  const { emptyData } = await import("../lib/types");
  const calls: unknown[] = [];
  const projects = Array.from({ length: 4 }, (_, i) => ({
    id: `project-${i}`,
    name: `Project ${i + 1}`,
    shape_id: i,
    description: "Project description",
    archived_at: null,
    deleted_at: null,
  }));
  const tasks = [
    {
      id: "task-one",
      project_id: "project-0",
      title: "Design the home page",
      description: "Keep this existing content",
      status: "To do",
      priority: "High",
      parent_task_id: null,
      due_date: "2026-10-01",
    },
    {
      id: "task-two",
      project_id: "project-0",
      title: "Completed work",
      status: "Done",
      priority: "Low",
      parent_task_id: null,
    },
    {
      id: "subtask",
      project_id: "project-0",
      title: "Prepare sketches",
      status: "Done",
      parent_task_id: "task-one",
    },
  ];
  const ctx: any = {
    data: { ...emptyData, projects, tasks },
    workspace: {
      id: "workspace",
      role: "owner",
      workflow_states: ["To do", "In progress", "Done"],
    },
    openTask: (...args: unknown[]) => calls.push(args),
    openProject: () => {},
    selectProject: (...args: unknown[]) => calls.push(args),
    mutate: async (...args: unknown[]) => {
      calls.push(args);
      return true;
    },
  };
  const user = userEvent.setup({ document: dom.window.document });
  render(
    <DashboardBoard ctx={ctx}>
      <h1>Existing studio summary</h1>
    </DashboardBoard>,
  );
  assert.ok(screen.getByText("Existing studio summary"), "Studio overview is the initial view");
  await user.click(
    screen.getByRole("button", { name: "Project board" }),
  );
  await user.click(
    screen.getByRole("button", { name: "View task: Design the home page" }),
  );
  assert.ok(screen.getByRole("dialog"));
  assert.ok(
    within(screen.getByRole("dialog")).getByText("Keep this existing content"),
  );
  assert.equal(
    (screen.getByRole("checkbox") as HTMLInputElement).checked,
    true,
  );
  await user.click(
    screen.getByRole("button", { name: "Edit task" }),
  );
  assert.equal((calls.at(-1) as any[])[0].id, "task-one");
  assert.equal(screen.queryByRole("dialog"), null);
  await user.click(screen.getByRole("button", { name: "Filter" }));
  await user.click(screen.getByRole("combobox", { name: "Status" }));
  await user.click(screen.getByRole("option", { name: "Done" }));
  await user.click(screen.getByRole("button", { name: "Apply filters" }));
  assert.equal(
    screen.queryByRole("button", { name: "View task: Design the home page" }),
    null,
  );
  assert.ok(screen.getByRole("button", { name: "View task: Completed work" }));
  await user.click(
    screen.getByRole("button", { name: "Remove status filter Done" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Add task to Project 1" }),
  );
  assert.deepEqual(calls.at(-1), [undefined, "project-0"]);
  await user.click(screen.getByRole("button", { name: "Next projects" }));
  assert.ok(
    screen
      .getByRole("region", { name: "Project 4 tasks" })
      .classList.contains("desktop-column"),
  );
  await user.click(
    within(screen.getByRole("group", { name: "Project columns" })).getByRole(
      "button",
      { name: "Project 4" },
    ),
  );
  assert.ok(
    screen
      .getByRole("region", { name: "Project 4 tasks" })
      .classList.contains("mobile-column"),
  );
  cleanup();
  render(
    <DashboardBoard
      ctx={{ ...ctx, workspace: { ...ctx.workspace, role: "client" } }}
    >
      <p>Summary</p>
    </DashboardBoard>,
  );
  assert.equal(
    screen.queryByRole("button", { name: "Add task to Project 1" }),
    null,
  );
  console.log(
    "Dashboard summary preservation, filters, task detail, project paging, mobile selection and read-only controls passed.",
  );
  cleanup();
  const { Calendar } = await import("../components/projects");
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  const calendarCtx = {...ctx, data: {...ctx.data, tasks: tasks.map(t => ({...t, due_date:date})), projects: projects.map(p => ({...p, due_date:date}))}};
  render(<Calendar ctx={calendarCtx} />);
  await user.click(screen.getByRole("button", {name:"Design the home page"}));
  assert.ok(within(screen.getByRole("dialog")).getByText("Keep this existing content"));
  assert.ok(screen.getByRole("button", {name:"Edit task"}));
  await user.keyboard("{Escape}");
  assert.equal(screen.queryByRole("dialog"), null);
  await user.click(screen.getByRole("button", {name:"Due: Project 1"}));
  assert.ok(within(screen.getByRole("dialog")).getByText("Task progress"));
  cleanup();
  render(<Calendar ctx={{...calendarCtx, workspace:{...ctx.workspace, role:"client"}}} />);
  await user.click(screen.getByRole("button", {name:"Design the home page"}));
  assert.ok(screen.getByRole("dialog"));
  assert.equal(screen.queryByRole("button", {name:"Edit task"}), null);
  cleanup();
  console.log("Calendar task/project modals, Escape dismissal, and client read-only access passed.");
  const { supabase } = await import("../lib/supabase");
  await supabase.auth.stopAutoRefresh();
  dom.window.close();
}
// Imported client libraries retain background handles in the standalone DOM harness.
main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
