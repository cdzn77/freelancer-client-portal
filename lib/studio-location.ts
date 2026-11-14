export const projectSections = [
  "Tasks",
  "Plan",
  "Scheduling",
  "Timeline",
  "Calendar",
  "Brief",
  "Discussions",
  "Files",
  "Review",
  "Scope changes",
  "Decisions",
  "Audit findings",
  "Access",
];
const staffPages = [
  "Overview",
  "Projects",
  "Inbox",
  "Requests",
  "Documents & payments",
  "Blueprints",
  "Team capacity",
  "My tasks",
  "Calendar",
  "Time tracking",
  "Profile",
];
const ownerPages = [
  "Studio insights",
  "Custom fields",
  "Client profitability",
  "Financials",
  "Website Monitor",
  "Settings",
];
export function readStudioLocation(search: string, role: string) {
  const q = new URLSearchParams(search);
  const home = role === "client" ? "Client portal" : "Overview";
  const allowed =
    role === "client"
      ? [
          "Client portal",
          "Requests",
          "Documents & payments",
          "Inbox",
          "Profile",
        ]
      : [...staffPages, ...(role === "owner" ? ownerPages : [])];
  const page = allowed.includes(q.get("page") ?? "") ? q.get("page")! : home;
  return {
    workspace: q.get("workspace") ?? "",
    page,
    project: page === "Projects" ? (q.get("project") ?? "") : "",
    section: projectSections.includes(q.get("section") ?? "")
      ? q.get("section")!
      : "Tasks",
  };
}
export function locationUrl(
  href: string,
  location: {
    workspace: string;
    page: string;
    project: string;
    section: string;
  },
) {
  const url = new URL(href);
  url.searchParams.set("workspace", location.workspace);
  url.searchParams.set("page", location.page);
  if (location.page === "Projects" && location.project) {
    url.searchParams.set("project", location.project);
    url.searchParams.set("section", location.section);
  } else {
    url.searchParams.delete("project");
    url.searchParams.delete("section");
  }
  return url;
}
