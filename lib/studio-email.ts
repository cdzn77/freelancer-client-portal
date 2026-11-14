import { serviceDB } from "./service-db";
import {
  emailMessage,
  googleToken,
  unseal,
  notificationSender,
} from "./google-email";
export async function deliverNotifications(
  onlyWorkspace?: string,
  preview = false,
) {
  if (!preview && process.env.ENABLE_NOTIFICATION_EMAIL_WORKER !== "true")
    return { disabled: true };
  const db = serviceDB();
  const { data: jobs, error } = await db.rpc("claim_studio_email_jobs", {
    only_workspace: onlyWorkspace || null,
  });
  if (error) throw Error("Could not claim notifications");
  await Promise.all(
    (jobs || []).map(async (job: any) => {
      let status = "Failed",
        message: string | null = null;
      try {
        const [
          { data: pref },
          { data: member },
          { data: notice },
          { data: connection },
        ] = await Promise.all([
          db
            .from("email_preferences")
            .select("enabled")
            .eq("workspace_id", job.workspace_id)
            .eq("user_id", job.user_id)
            .maybeSingle(),
          db
            .from("workspace_members")
            .select("role")
            .eq("workspace_id", job.workspace_id)
            .eq("user_id", job.user_id)
            .maybeSingle(),
          db
            .from("studio_notifications")
            .select(
              "read_at,archived_at,deleted_at,project_id,discussion_id,task_id,billing_document_id,billing_reminder_group",
            )
            .eq("id", job.notification_id)
            .maybeSingle(),
          db
            .from("google_email_connections")
            .select("*")
            .eq("workspace_id", job.workspace_id)
            .maybeSingle(),
        ]);
        let projectAccess = true;
        if (notice?.project_id && member?.role !== "owner") {
          const [{ data: project }, { data: invite }] = await Promise.all([
            db
              .from("projects")
              .select("access_type")
              .eq("id", notice.project_id)
              .eq("workspace_id", job.workspace_id)
              .maybeSingle(),
            db
              .from("project_members")
              .select("role")
              .eq("project_id", notice.project_id)
              .eq("user_id", job.user_id)
              .maybeSingle(),
          ]);
          projectAccess =
            !!project &&
            (member?.role === "client"
              ? invite?.role === "guest"
              : ["owner", "member"].includes(invite?.role || "") ||
                project.access_type === "workspace");
        }
        if (notice?.task_id && member?.role === "client") {
          const task = await db
            .from("tasks")
            .select("is_published,projects(client_tools,deleted_at)")
            .eq("id", notice.task_id)
            .maybeSingle();
          const project = task.data?.projects as unknown as {
            client_tools: string[];
            deleted_at: string | null;
          } | null;
          projectAccess =
            projectAccess &&
            !task.error &&
            !!task.data?.is_published &&
            !!project?.client_tools.includes("tasks") &&
            !project.deleted_at;
        }
        if (notice?.discussion_id) {
          const permitted = await db.rpc("discussion_recipient_allowed", {
            t: notice.discussion_id,
            u: job.user_id,
          });
          projectAccess =
            projectAccess && !permitted.error && permitted.data === true;
        }
        if (notice?.billing_document_id) {
          const allowed = await db.rpc("billing_notice_allowed", {
            doc: notice.billing_document_id,
            u: job.user_id,
          });
          projectAccess =
            projectAccess && !allowed.error && allowed.data === true;
        }
        if (notice?.billing_reminder_group) {
          const allowed = await db.rpc("billing_reminder_ready", {
            g: notice.billing_reminder_group,
            recipient: job.user_id,
            for_email: true,
          });
          projectAccess =
            projectAccess && !allowed.error && allowed.data === true;
        }
        if (
          !projectAccess ||
          !pref?.enabled ||
          !member ||
          !notice ||
          notice.read_at ||
          notice.archived_at ||
          notice.deleted_at
        )
          status = "Skipped";
        else if (preview) status = "Preview";
        else {
          if (!connection || connection.sender !== notificationSender)
            throw Error("Connect the sender mailbox first.");
          const { data: owner } = await db
            .from("workspace_members")
            .select("role")
            .eq("workspace_id", job.workspace_id)
            .eq("user_id", connection.connected_by)
            .maybeSingle();
          if (owner?.role !== "owner")
            throw Error("Reconnect the sender with a current administrator.");
          const appUrl = process.env.PMS_PUBLIC_URL;
          if (!appUrl || new URL(appUrl).protocol !== "https:")
            throw Error("Configure the public HTTPS PMS URL.");
          const {
            data: { user },
            error,
          } = await db.auth.admin.getUserById(job.user_id);
          if (error || !user?.email || !user.email_confirmed_at)
            throw Error("Recipient email is not verified.");
          const token = await googleToken({
            grant_type: "refresh_token",
            refresh_token: unseal(connection.encrypted_refresh_token),
          });
          let replyToken: string | undefined;
          if (notice.discussion_id && connection.reply_enabled) {
            const tokenRecord = await db
              .from("discussion_email_replies")
              .upsert(
                {
                  notification_id: job.notification_id,
                  thread_id: notice.discussion_id,
                  user_id: job.user_id,
                },
                { onConflict: "notification_id", ignoreDuplicates: true },
              );
            if (tokenRecord.error) throw Error("Could not prepare email reply");
            const replyRecord = await db
              .from("discussion_email_replies")
              .select("token")
              .eq("notification_id", job.notification_id)
              .single();
            if (replyRecord.error) throw Error("Could not prepare email reply");
            replyToken = replyRecord.data.token;
          }
          const destination = new URL(appUrl);
          destination.searchParams.set("workspace", job.workspace_id);
          if (notice.discussion_id)
            destination.searchParams.set("discussion", notice.discussion_id);
          if (notice.task_id)
            destination.searchParams.set("task", notice.task_id);
          if (notice.billing_document_id) {
            destination.searchParams.set("page", "Documents & payments");
            destination.searchParams.set(
              "clientDocument",
              notice.billing_document_id,
            );
          } else if (notice.project_id) {
            destination.searchParams.set(
              "page",
              member.role === "client" ? "Client portal" : "Projects",
            );
            destination.searchParams.set("project", notice.project_id);
            destination.searchParams.set(
              "section",
              notice.task_id ? "Tasks" : "Discussions",
            );
            destination.searchParams.set("clientProject", notice.project_id);
            destination.searchParams.set("clientView", "Project");
            destination.searchParams.set(
              "clientSection",
              notice.task_id ? "Tasks" : "Messages",
            );
          }
          // Recheck just before delivery so a queued reminder respects payments and opt-outs.
          const current = notice.billing_reminder_group
            ? await db.rpc("billing_reminder_ready", {
                g: notice.billing_reminder_group,
                recipient: job.user_id,
                for_email: true,
              })
            : { data: true, error: null };
          if (current.error)
            throw Error("Could not verify the reminder balance");
          if (!current.data) status = "Skipped";
          else {
            const response = await fetch(
              "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token.access_token}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  raw: emailMessage(
                    user.email,
                    job.id,
                    destination.href,
                    replyToken,
                  ),
                }),
                signal: AbortSignal.timeout(8000),
              },
            );
            if (!response.ok)
              throw Error(
                "Google did not confirm delivery. Check the sender mailbox before retrying.",
              );
            status = "Sent";
          }
        }
      } catch {
        message =
          "Delivery was not confirmed. Check Google connection and sender mailbox; no automatic retry to avoid duplicates.";
      }
      const { error: saveError } = await db
        .from("studio_email_jobs")
        .update({
          status,
          last_error: message,
          sent_at: status === "Sent" ? new Date().toISOString() : null,
        })
        .eq("id", job.id)
        .eq("lease_id", job.lease_id)
        .eq("status", "Sending");
      if (saveError) throw Error("Could not record delivery result");
    }),
  );
  return { processed: jobs?.length || 0 };
}
