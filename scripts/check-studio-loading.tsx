import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import type { Session } from "@supabase/supabase-js";
import { Studio } from "../components/studio";
const session = {
  user: {
    id: "loading-check",
    email: "loading@example.test",
    user_metadata: {},
  },
} as Session;
const html = renderToString(<Studio session={session} />);
assert.ok(
  html.includes("Gathering your workspace..."),
  "Workspace loading state must render before context exists",
);
console.log("Workspace startup renders without a loaded context.");
