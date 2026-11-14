import type { Data, Project } from "./types";
/** Visibility is still enforced by database policies; only known project members appear in the picker. */
export function projectPeople(data: Data, project: Project) {
  return data.members.filter(
    (m) =>
      m.role === "owner" ||
      data.project_members.some(
        (pm) => pm.project_id === project.id && pm.user_id === m.user_id,
      ) ||
      (project.access_type === "workspace" &&
        ["member", "contractor"].includes(m.role)),
  );
}
