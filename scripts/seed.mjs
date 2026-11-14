import { createClient } from "@supabase/supabase-js";
const client = createClient(
  process.env.SUPABASE_URL || "http://127.0.0.1:8000",
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
if (
  !["127.0.0.1", "localhost"].includes(
    new URL(process.env.SUPABASE_URL || "http://127.0.0.1:8000").hostname,
  )
)
  throw Error("Demo seed only runs against localhost.");
const password = "Studio-demo-2026!";
async function check(r) {
  if (r.error) throw r.error;
  return r.data;
}
const existing = await check(await client.auth.admin.listUsers());
const users = [];
for (const [email, name] of [
  ["admin@studio.test", "Alex Freelancer"],
  ["mia@studio.test", "Mia Chen"],
  ["jules@studio.test", "Jules Rivera"],
  ["client@northstar.test", "Alex Morgan"],
  ["contractor@studio.test", "Sam Lee"],
]) {
  const old = existing.users.find((u) => u.email === email);
  if (old) users.push({ ...old, name });
  else {
    const result = await check(
      await client.auth.admin.createUser({
        app_metadata: { pms_admin_provisioned: true },
        email,
        password,
        email_confirm: true,
        user_metadata: { name },
      }),
    );
    users.push({ ...result.user, name });
  }
}
const w1 = "10000000-0000-4000-8000-000000000001",
  w2 = "10000000-0000-4000-8000-000000000002";
if (
  (await check(await client.from("workspaces").select("id").eq("id", w1)))
    .length
) {
  console.log("Seed workspace exists, preserving existing work.");
  process.exit(0);
}
await check(
  await client.from("workspaces").insert([
    { id: w1, name: "Example Studio" },
    { id: w2, name: "Northstar Studio" },
  ]),
);
await check(
  await client.from("workspace_members").insert([
    {
      workspace_id: w1,
      user_id: users[0].id,
      display_name: users[0].name,
      role: "owner",
    },
    {
      workspace_id: w1,
      user_id: users[1].id,
      display_name: users[1].name,
      role: "member",
    },
    {
      workspace_id: w1,
      user_id: users[2].id,
      display_name: users[2].name,
      role: "member",
    },
    {
      workspace_id: w1,
      user_id: users[4].id,
      display_name: users[4].name,
      role: "contractor",
    },
    {
      workspace_id: w2,
      user_id: users[0].id,
      display_name: users[0].name,
      role: "owner",
    },
    {
      workspace_id: w2,
      user_id: users[3].id,
      display_name: users[3].name,
      role: "client",
    },
  ]),
);
const date = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};
const projects = await check(
  await client
    .from("projects")
    .insert([
      {
        workspace_id: w1,
        name: "Brand, with a fresh perspective",
        client_name: "Forma Studio",
        description: "A thoughtful identity for a new chapter.",
        brief:
          "Create a warm, confident identity for an independent architecture studio. Deliver a wordmark, color palette, type system, and a practical brand guide. Success means a flexible identity that feels equally at home in print and on screen.",
        type: "fixed_fee",
        color: "coral",
        start_date: date(-20),
        due_date: date(12),
      },
      {
        workspace_id: w1,
        name: "A better digital experience",
        client_name: "Northstar",
        description: "Turning a big vision into a simple experience.",
        brief:
          "Redesign the discovery and booking experience. Focus on a clear information hierarchy, accessible patterns, and a friction-free mobile journey.",
        type: "time_materials",
        color: "lilac",
        start_date: date(-12),
        due_date: date(20),
      },
      {
        workspace_id: w1,
        name: "Everyday, a little brighter",
        client_name: "Bloom & Co.",
        description: "Creative support for a growing brand.",
        brief:
          "An ongoing partnership for monthly campaign creative and website improvements. Reserve 30 hours each month and carry unused time into the next period.",
        type: "retainer",
        color: "green",
        start_date: date(-8),
        due_date: date(28),
      },
      {
        workspace_id: w2,
        name: "Northstar website",
        client_name: "Northstar",
        description: "A clearer path from discovery to booking.",
        brief:
          "Your new website brings the Northstar story to life with a clear booking journey and a fresh visual direction.",
        type: "fixed_fee",
        color: "blue",
        start_date: date(-14),
        due_date: date(21),
      },
    ])
    .select(),
);
await check(
  await client
    .from("project_members")
    .insert([
      ...projects.map((p) => ({
        workspace_id: p.workspace_id,
        project_id: p.id,
        user_id: users[0].id,
        role: "owner",
      })),
      ...projects
        .filter((p) => p.workspace_id === w1)
        .flatMap((p) =>
          [users[1], users[2]].map((u) => ({
            workspace_id: w1,
            project_id: p.id,
            user_id: u.id,
            role: "member",
          })),
        ),
      {
        workspace_id: w2,
        project_id: projects[3].id,
        user_id: users[3].id,
        role: "guest",
      },
    ]),
);
const names = [
  [
    "Review brand direction",
    "Build the visual identity",
    "Finalize the brand guidelines",
    "Explore type and color",
    "Gather the first impressions",
    "Define the creative brief",
    "Present the initial concepts",
    "Package the final assets",
  ],
  [
    "Map the booking journey",
    "Design the homepage",
    "Refine the mobile experience",
    "Prototype the key flows",
    "Review accessibility",
    "Audit the current experience",
  ],
  [
    "Design the autumn campaign",
    "Update the social templates",
    "Create the monthly newsletter",
    "Align on campaign goals",
  ],
];
let all = [];
names.forEach((ns, i) =>
  ns.forEach((title, j) =>
    all.push({
      workspace_id: w1,
      project_id: projects[i].id,
      title,
      description: [
        "Bring the latest feedback into the next iteration.",
        "Keep the experience clear, useful, and considered.",
        "A final check before sharing with the client.",
      ][j % 3],
      status:
        j >= 3
          ? "Done"
          : j === 0
            ? "In review"
            : j === 1
              ? "In progress"
              : "To do",
      priority: j === 0 ? "High" : j === 1 ? "Medium" : "Low",
      due_date: date(j + i),
      assignee_id: users[j % 3 === 2 ? 1 : 0].id,
      custom_fields: { Discipline: i === 0 ? "Brand" : "Design" },
    }),
  ),
);
all.push(
  ...[
    "Approve the visual direction",
    "Review homepage layouts",
    "Explore the website structure",
    "Agree on the project brief",
  ].map((title, i) => ({
    workspace_id: w2,
    project_id: projects[3].id,
    title,
    description: "Your feedback helps shape the next step.",
    status: i > 1 ? "Done" : "In review",
    priority: "Medium",
    due_date: date(i + 3),
    assignee_id: users[0].id,
    custom_fields: {},
  })),
);
const tasks = await check(await client.from("tasks").insert(all).select());
await check(
  await client.from("tasks").insert({
    workspace_id: w1,
    project_id: projects[0].id,
    title: "Check the wordmark at small sizes",
    parent_task_id: tasks[0].id,
    assignee_id: users[0].id,
    status: "To do",
    priority: "Medium",
    due_date: date(1),
  }),
);
await check(
  await client.from("dependencies").insert({
    workspace_id: w1,
    task_id: tasks[2].id,
    depends_on_id: tasks[1].id,
  }),
);
await check(
  await client.from("budgets").insert(
    projects.map((p, i) => ({
      workspace_id: p.workspace_id,
      project_id: p.id,
      amount: [12000, 18000, 4500, 15000][i],
    })),
  ),
);
const times = [];
for (let day = 0; day < 14; day++)
  for (let p = 0; p < 3; p++)
    times.push({
      workspace_id: w1,
      project_id: projects[p].id,
      description: [
        "Brand exploration",
        "Experience design",
        "Campaign creative",
      ][p],
      minutes: [90, 120, 60, 150, 180, 90, 120][day % 7],
      entry_date: date(-day),
      billable: day % 6 !== 0,
      cost_rate: 65,
      bill_rate: 150,
      status: day > 2 ? "Approved" : "Submitted",
      created_by: users[0].id,
    });
times.push({
  workspace_id: w2,
  project_id: projects[3].id,
  description: "Website design",
  minutes: 360,
  entry_date: date(-1),
  billable: true,
  cost_rate: 65,
  bill_rate: 150,
  status: "Submitted",
  created_by: users[0].id,
});
await check(await client.from("time_entries").insert(times));
for (const kind of ["invoices", "estimates"])
  await check(
    await client.from(kind).insert(
      [0, 1, 3].map((i) => ({
        workspace_id: projects[i].workspace_id,
        project_id: projects[i].id,
        number: `${kind === "invoices" ? "INV" : "EST"}-2026-00${i + 1}`,
        client_name: projects[i].client_name,
        status:
          kind === "invoices" && i === 0
            ? "Paid"
            : kind === "invoices"
              ? "Sent"
              : "Draft",
        due_date: date(14),
        notes:
          "Thank you for making good things with us. Payment by bank transfer.",
        lines: [
          {
            description:
              kind === "invoices"
                ? "Design services, first milestone"
                : "Design services, project scope",
            quantity: 1,
            rate: [3600, 5400, 0, 4500][i],
          },
        ],
      })),
    ),
  );
await check(
  await client.from("retainers").insert({
    workspace_id: w1,
    project_id: projects[2].id,
    period: new Date().toISOString().slice(0, 7) + "-01",
    hours: 30,
    rollover: 5,
    used: 18,
  }),
);
await check(
  await client.from("templates").insert([
    {
      workspace_id: w1,
      name: "A thoughtful project kickoff",
      tasks: [
        "Gather the brief",
        "Align on goals and audience",
        "Define the deliverables",
        "Plan the first review",
      ],
    },
    {
      workspace_id: w1,
      name: "Design quality check",
      tasks: [
        "Review keyboard navigation",
        "Check color contrast",
        "Test the mobile layouts",
        "Prepare the handoff",
      ],
    },
  ]),
);
await check(
  await client.from("comments").insert([
    {
      workspace_id: w2,
      project_id: projects[3].id,
      body: "The first round is ready for your eyes. We would love your thoughts on the visual direction.",
      created_by: users[0].id,
    },
  ]),
);
await check(
  await client.from("approvals").insert({
    workspace_id: w2,
    project_id: projects[3].id,
    label: "Visual direction, round one",
  }),
);
console.log(
  "Seeded two isolated workspaces, projects, tasks, time, budgets, estimates, invoices, and a client review.",
);
