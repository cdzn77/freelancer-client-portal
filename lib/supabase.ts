import { createClient } from "@supabase/supabase-js";
// Capture only the flow type before Supabase consumes and clears the URL fragment.
const authFragment =
  typeof window === "undefined"
    ? null
    : new URLSearchParams(window.location.hash.slice(1));
export const passwordLinkFlow = ["recovery", "magiclink", "invite"].includes(
  authFragment?.get("type") || "",
);
export const authLinkError = authFragment?.has("error")
  ? "This sign-in link has expired or was already used. Request a new password reset link below."
  : "";
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:8000",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "local-setup-required",
  {
    global: {
      fetch: async (input, init) => {
        if (
          typeof window !== "undefined" &&
          window.location.pathname === "/client-preview"
        ) {
          const url = new URL(
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url,
          );
          const method = (
            init?.method || (input instanceof Request ? input.method : "GET")
          ).toUpperCase();
          const allowedRpc = [
            "workspace_role",
            "pms_security_status",
            "preview_client_project",
            "preview_client_collaboration",
            "client_time_report",
            "preview_project_registers",
          ];
          if (
            !["GET", "HEAD"].includes(method) &&
            !url.pathname.startsWith("/auth/v1/") &&
            !(
              method === "POST" &&
              allowedRpc.some((name) => url.pathname === `/rest/v1/rpc/${name}`)
            )
          )
            throw Error("Client preview is read-only.");
        }
        return fetch(input, init);
      },
    },
  },
);
