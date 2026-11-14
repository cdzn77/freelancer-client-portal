
import { brand } from "../../lib/brand";
import type { Metadata } from "next";
import { PublicInformation } from "@/components/public-information";
export const metadata: Metadata = {
  title: (brand.appName + " | Studio workspace"),
  description:
    "A private workspace for studio projects, expenses, subscriptions and reviewed email receipts.",
};
export default function AboutPage() {
  return (
    <PublicInformation title="A workspace for the work behind the work.">
      <p>
        {brand.appName} is a studio management application operated by{" "}
        {brand.name}. It helps authorized studio members organize projects,
        tasks, time, client collaboration, expenses and subscriptions.
      </p>
      <h2>Projects and studio operations</h2>
      <p>
        Keep briefs, tasks, deliverables and project updates together. Workspace
        roles determine which records a member or invited collaborator can
        access.
      </p>
      <h2>Expenses and subscriptions</h2>
      <p>
        Record actual payments, maintain a separate subscription register and
        review future charges. Tracking a subscription does not add it to
        spending. Forecasting is optional, and neither a forecast nor an email
        scan makes a payment on your behalf.
      </p>
      <h2>Google email connections</h2>
      <p>
        A workspace administrator can connect supported Google mailboxes
        separately to find receipts, invoices, renewals and cancellation
        notices. The receipt connection requests Google account identity and
        read-only Gmail access. Although this permission covers the mailbox, PMS
        searches for financial email subjects and stores selected message
        details and limited text excerpts for review.
      </p>
      <p>
        New findings enter a review queue. An administrator confirms details
        before creating a payment or updating a subscription. Duplicate checks
        reduce repeated entries. PDF and image-only receipts may need manual
        review.
      </p>
      <p>
        A separate, optional Gmail sending connection supports workspace
        notification emails when enabled. Connecting receipt sync does not
        enable that sending connection.
      </p>
      <h2>Your workspace, your controls</h2>
      <p>
        Connections can be paused or disconnected in Studio expenses.
        Disconnecting stops future receipt fetching without removing saved
        expense records. You can also revoke the app’s access from your Google
        Account.
      </p>
      <p>
        Read our <a href="/privacy">privacy policy</a> for data access, storage,
        retention and deletion details, and our{" "}
        <a href="/terms">terms of service</a> for use of the workspace.
      </p>
      <p>
        <a href="/">Open your workspace</a> ·{" "}
        <a href={"mailto:" + brand.email}>Contact {brand.name}</a>
      </p>
    </PublicInformation>
  );
}
