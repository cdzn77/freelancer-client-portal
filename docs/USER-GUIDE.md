# Freelancer Client Portal

Installation and everyday use guide

Version 0.1.0 | November 14, 2026

A step-by-step reference for the freelancer who runs the portal, the team members who deliver the work, and the clients who review it. This guide describes the white-label template distributed with this repository. Your studio name, enabled integrations, permissions, and shared tools determine what appears in an installation.

Repository: https://github.com/cdzn77/freelancer-client-portal

## 01 | Start here

The portal has two main experiences. Administrators and regular team members use a workspace with projects and delivery tools. Clients use a simpler portal with only the projects and content shared with them. A GitHub template gives you your own copy of the source; it does not create a hosted service automatically. Open User guide (PDF) from sign-in or the workspace footer to return to this guide.

1. Read chapters 02 through 05 to install a local demonstration or an empty studio workspace.
2. Set your public brand using chapter 06.
3. Learn roles and client visibility in chapters 07 through 09 before inviting anyone.
4. Create one test project and follow its work through tasks, files, review, and billing.
5. Use the client walkthroughs in chapters 30 through 32 to check the other side of the experience.
6. Follow chapter 33 to deploy a hosted installation. Keep the local demo separate from real work.

The baseline setup uses Node.js 24 and Docker with Compose. Supabase supplies the database, authentication, storage, and access policies. Paid providers are optional. Email delivery, online payments, and AI calls need your own accounts and configuration.

This version is designed around one public studio identity per deployment. Multiple workspaces can have separate names and membership, but they share that deployment's logo, public contact information, and default document identity. It is not a hosted reseller platform with a separate custom domain and brand for every workspace.

## 02 | Copy the template and prepare your computer

You need Git, Node.js 24 with npm, and Docker Desktop or Docker Engine with the Compose plugin. Allow approximately 8 GB of available memory for the full local Supabase stack, plus space for container images, dependencies, and future uploads.

1. Open the repository on GitHub and choose Use this template, then Create a new repository.
2. Choose your account and repository name. Choose Private if you will keep business-specific changes in your copy.
3. Clone your new repository to your computer. You can also download its ZIP and extract it.
4. Open a terminal in the folder containing `package.json` and `docker-compose.yml`.
5. Confirm that `node --version` reports v24 and `docker compose version` succeeds.
6. Start Docker and wait until its engine is ready. `docker info` should show server information without a connection error.
7. Run `npm ci` to install the pinned dependencies.

Run all commands in this guide from that repository folder unless a step says otherwise. Keep the folder somewhere you can find and back up. Do not copy another operator's `.env`, database, or deployment state into your installation.

Expected result: the repository is on your computer, dependencies are installed, and Docker can run containers. No client account or project exists yet.

## 03 | Start the local database and app

The setup script creates random credentials for a new local Supabase stack. It preserves an existing `.env` instead of replacing it.

1. Run `npm run setup`.
2. Confirm that `.env` and `.env.local` were created. They are private and ignored by Git.
3. Start the backend:

```sh
docker compose up -d --wait --wait-timeout 240
```

4. Apply all application migrations:

```sh
sh scripts/migrate.sh
```

5. Choose either the demonstration in chapter 04 or an empty workspace in chapter 05.
6. Start the app with `npm run dev`.
7. Open `http://127.0.0.1:3100` in your browser. Keep the terminal process running while using development mode.

The migration script records completed migrations and applies new ones in filename order. It does not recreate your database on every run. Read any error before retrying; a partially unavailable container is different from a failed migration.

Local addresses: app on port 3100, Supabase gateway on port 8000, and Mailpit on port 8025. Auth messages sent through the local mail configuration appear in Mailpit. They are not delivered to an external mailbox.

To stop the backend without deleting records, run `docker compose stop`. Use Ctrl+C in the app terminal to stop development mode. Do not use `docker compose down -v` on an installation whose data you want to retain; that option removes named volumes.

## 04 | Explore the fictional demonstration

The demo seed creates fictional projects and accounts. Its fixed password is intended only for an isolated local demonstration. The seed refuses non-localhost Supabase URLs.

1. After setup and migrations, run:

```sh
node --env-file=.env scripts/seed.mjs
npm run dev
```

2. Sign in as `admin@studio.test` with `Studio-demo-2026!`.
3. Use the workspace switcher to inspect Example Studio and Northstar Studio.
4. Explore a project, open its Tasks and Access sections, and inspect the available sharing controls.
5. Open a separate browser profile or private window and sign in as `client@northstar.test` with the same demo password.
6. Compare what that client can see with what the administrator sees in Northstar Studio.

Other seeded accounts are `mia@studio.test`, `jules@studio.test`, and `contractor@studio.test`. They demonstrate restricted team access. They do not all have the administrator's permissions.

Rerunning the seed preserves an existing seeded workspace. It is not a reset command. For a clean production installation, use a separate empty database and chapter 05; do not publish a seeded database with these demonstration credentials.

Expected result: you can switch between an administrator's view and a client's view and understand why internal records do not appear to the client.

## 05 | Create your first administrator

Public registration is closed. A new empty installation needs its first administrator created through the operator-only CLI. Later accounts are created or added from Workspace settings.

1. Complete setup and migrations without running the demo seed.
2. Open the private `.env` file locally and add your own values:

```dotenv
ADMIN_EMAIL=you@your-studio.example
ADMIN_NAME=Your Name
ADMIN_WORKSPACE=Your Studio
```

3. Run `npm run setup:admin`.
4. Save the generated initial password from the terminal in a password manager. You may instead supply a private `ADMIN_PASSWORD` of at least 16 characters.
5. Remove the `ADMIN_*` values from `.env` after successful setup.
6. Start the app, sign in, and open your profile to set your preferred password and enroll an authenticator.
7. Confirm that your workspace appears and that Workspace settings is available.

The command checks for an existing administrator and refuses to run if one exists. It creates an explicitly provisioned Auth identity, signs in as that user, and uses the authenticated workspace-creation function. It does not add a public registration endpoint.

If the command reports that an administrator already exists, use that account or its password-recovery flow. Do not remove the owner check to force access. If migration checks fail, resolve the database setup first. If setup cannot clean up a new identity after an error, it tells you to review Supabase Auth before retrying.

## 06 | Apply your own brand

Public identity settings live in `config/brand.json`. They are shipped to browsers, so this file must contain no passwords, tokens, or private keys.

1. Set `name` to your studio or freelancer name and `appName` to your portal's product name.
2. Set `ownerName` and `email` to the default document signer and public support address.
3. Set `websiteUrl` to your public website and `portalUrl` to this portal's address. Use full HTTPS URLs when hosted.
4. Leave `logoPath` empty for a text wordmark, or add your logo under `public/brand/` and set its path, such as `/brand/logo.svg`.
5. Replace the favicon asset or change `faviconPath`.
6. Set `tagline`, `accentColor`, and `accentTextColor`. Check the button text against its background at normal and hover states.
7. Restart development mode or rebuild and redeploy with `npm run build`.
8. Check sign-in, the client header, public pages, invitation copy, and a newly exported PDF.

PDF headers use your studio name as text. This avoids assuming that a custom browser SVG works in the PDF renderer. Existing saved documents keep their own stored content; changing a default does not rewrite approved agreements.

Review the service catalog and document wording in `lib/service-catalog.ts`, `lib/document-templates.ts`, and `lib/client-documents.ts`. The inherited document workflow includes a 50% deposit rule. Change commercial behavior deliberately and test it rather than only editing the displayed words.

Replace the placeholder Privacy and Terms pages before collecting client data. The software license does not supply your studio's client agreement or deployment privacy policy.

## 07 | Sign in, profile, password, and MFA

Every user has their own identity. Workspace roles determine access; editing a profile does not grant permissions.

1. Sign in with the email and initial password provided by your administrator.
2. If the first-login password screen appears, choose your own password and complete it before entering the workspace.
3. Select your avatar or My profile to edit your name, job title, company, website, bio, time zone, and available profile-photo controls.
4. Save the profile and confirm the updated name or avatar appears.
5. To change email or password, use the account security controls and provide the required current-password verification.
6. For MFA, open Two-factor authentication, scan the QR code with your authenticator, enter the current code, and finish enrollment.
7. Sign out using the profile's Sign out action when you are done on a shared device.

Password recovery starts from the sign-in screen. Request a reset, open the newest email link, and complete any MFA challenge before saving the new password. In local development, check Mailpit rather than your real inbox. In a hosted installation, the operator must configure Auth email delivery and allowed redirect URLs.

If a code fails, confirm your authenticator's time and use the current code. If account-security state cannot be verified, the app keeps the protected action closed and offers a retry. Contact the operator if you lose access to the enrolled authenticator; profile editing cannot bypass it.

## 08 | Workspace settings and inviting people

Where: Workspace settings. Administrator access is required for membership management.

1. Open Workspace details, enter the workspace name, and save.
2. Review Workflow states, separated by commas. Use unique labels, keep at least two states, and retain `Done` as the completion state.
3. Find Invite someone to the workspace. Create an account for a new person, or add an existing account by email.
4. Choose Administrator, Regular user, or Client / Guest according to the person's responsibility.
5. Assign optional project access where the form provides it.
6. Use Copy invitation to obtain the login handoff and share it privately with that person.
7. Review The people behind the work to change roles or remove membership when needed.
8. Add a reusable task template by entering a name and one task per line.

Administrators manage workspace settings, membership, and financial records. Regular users work in invited projects and projects deliberately opened to the workspace. Clients require explicit project invitations. A project-owner assignment is a project responsibility, not a promotion to workspace administrator.

The last administrator cannot be removed. Removing someone from one workspace does not delete their login or memberships in other workspaces. Confirm project access separately after changing a role.

Expected result: each person signs in with their own account and sees the intended workspace and projects. Never share the owner's login with clients as a shortcut.

## 09 | Project access and client visibility

Where: Projects > select project > Access. An administrator or project owner manages the project boundary.

1. Add the people who should work on or review the project.
2. Assign project owners where needed. Keep ownership limited to people responsible for project administration.
3. Choose invite-only or workspace-wide access for team members. Workspace-wide access does not automatically include guests.
4. Enable only the client tools you intend to use, such as tasks, files, discussions, or approvals.
5. Open the relevant section and explicitly share the individual task, file, discussion, brief, or review version.
6. Use View as client as a quick preview, then verify with an actual invited client account in a separate browser session.
7. Check that a second client account cannot see this project.

Client access depends on three things together: project membership, the enabled tool, and the item's shared state. Enabling Files does not publish every file. Inviting a client does not reveal the internal brief.

Some team edits to shared content return it to internal review. Recheck the shared state after editing. Saved internal notes, cost rates, financial records, and unpublished work should remain outside the guest view.

Removing access stops future authorized reads, but it cannot recall a file someone already downloaded. Archive and Trash organize records; do not use them as substitutes for changing access permissions.

## 10 | Overview, search, and Inbox

Where: Overview, the header search control, and Inbox.

1. Start on Overview to review active work, due tasks, recent records, and workspace totals.
2. Open a dashboard card to move to its underlying project or work section.
3. Use Search workspace in the header, or the displayed keyboard shortcut, to find records you can access.
4. Search by a useful project, task, or client name and open the matching result.
5. Open Inbox to review your notifications and follow links to the relevant request or project activity.
6. Mark or manage notifications using the available controls after reviewing the underlying record.
7. Open Email notifications within Inbox if you want email updates and the operator has configured delivery.

Dashboard and search results are scoped to the selected workspace and your permissions. If something seems missing, first check the workspace switcher, project access, filters, and archive state. Searching for another person's record does not grant access to it.

Email is separate from the in-app Inbox. The local application can show notifications without a paid provider or a running email worker. A connected mailbox alone does not guarantee delivery: the server's notification worker must be enabled and healthy.

Expected result: use Overview for priorities, Search for direct navigation, and Inbox for changes that need your attention.

## 11 | Create and organize projects

Where: Projects.

1. Create a project and give it a clear name and client name.
2. Choose its commercial type, such as fixed fee, time and materials, or retainer, using the fields shown.
3. Add a description, start and due dates, and the appropriate status.
4. Choose a color and project shape so related work is easy to recognize.
5. Open the project to work in its section tabs. Add people through Access before assigning them work.
6. Write the internal brief. Prepare and share the guest-facing brief separately when ready.
7. Use Active, Archived, or Trash filters to locate projects that no longer appear in active views.
8. Archive a finished project when you want to preserve its records without keeping it in the active workload.

The project sections include Tasks, Plan, Scheduling, Timeline, Calendar, Brief, Discussions, Files, Review, Scope changes, Decisions, Audit findings, and Access. Some controls depend on your role.

Delete and Archive have different purposes. Read the confirmation before deleting. Recoverable Trash retains records until a supported permanent-deletion action is explicitly used. Financial and time history may remain available even when a project is inactive.

Expected result: one project represents one coherent engagement, with its delivery history, shared content, and people together. Do not create a second project merely because you need a new task or review version.

## 12 | Tasks, My tasks, and custom fields

Where: Projects > Tasks, or My tasks for your assigned work.

1. Create a task with a specific title and the intended project.
2. Add its description, assignee, priority, due date, and workflow state.
3. Use subtasks for work that belongs under a larger task. Use dependencies for work that must happen first.
4. Switch between list and board views to suit the review you are doing.
5. Use filters and saved views to focus on a status, person, priority, or other available criterion.
6. Open task details to record checkpoints, comments, planning information, and available linked evidence.
7. Move completed work to Done. Do not use a custom state that only looks like completion if the workflow expects Done.
8. Share a task only after checking its text and the project's client-tool settings.

Administrators can define workspace fields under Custom fields. Supported types are text, number, date, select, and boolean. For a select field, enter one allowed choice per line. Save the field, then fill it on relevant tasks. Use a small set of fields your team will actually maintain.

Dependencies are checked for cycles. Deleting a parent task can leave its subtasks as top-level tasks and remove dependency links, so inspect the result. A recurring-task rule and an ordinary task are different records; inspect generated work before assuming a schedule has run.

## 13 | Plan, scheduling, timeline, and calendar

Where: a project's Plan, Scheduling, Timeline, and Calendar tabs.

1. Open Plan to inspect the blueprint applications that created the project's tasks. Live task progress stays in Tasks.
2. Open Scheduling, choose a task, and inspect its current start, due date, effort, and dependency information.
3. Enter the proposed dates and preview dependency changes before applying them.
4. Review every affected task in the preview. Completed and pinned tasks keep their dates.
5. Apply the schedule change only when the preview matches the intended plan.
6. Use Daily allocation to distribute effort across working days where available.
7. Set project working days and non-working dates in Project work calendar.
8. Use Timeline for a visual date overview and its text equivalent. Use Calendar for date-based navigation.

The timeline is a planning view; do not assume that dragging a bar reschedules work. Change dates through task or scheduling controls. Individual leave can produce a capacity warning without automatically moving task dates.

Resource bookings and task allocations are designed to avoid counting the same effort twice. When reviewing availability, distinguish a project's booking envelope from additional task effort outside it.

Expected result: a saved schedule whose dependencies and dates have been reviewed, with the same information understandable from the text views.

## 14 | Files and delivery

Where: Projects > Files.

1. Open the correct project before uploading.
2. Upload the intended file and wait for the application to confirm completion.
3. Check the filename, type, size, and any available preview.
4. Keep drafts internal. Share the specific file only when it is ready for the client's Files section.
5. Enable the Files tool in project Access if the client should see shared files.
6. Test opening or downloading the file from the invited client account.
7. Upload a new deliverable version through Review when feedback needs to remain tied to a specific version.
8. Use the file's deletion control only after reading whether its stored contents will also be removed.

Private storage is the default. Download links are short-lived; an expired link should be reopened from the portal rather than copied into a permanent document. Alternate storage providers require server configuration and do not replace project authorization checks.

Phone uploads use the browser's file picker and supported file types. If an image fails, inspect the error and the allowed format/size rather than repeatedly submitting the same file. Large hosted uploads may need direct Supabase uploads configured by the operator.

Expected result: clients can download only the files you shared for their invited project. A file upload by itself is not an approval request.

## 15 | Discussions, messages, and decisions

Where: Projects > Discussions, Decisions, and Audit findings.

1. Start a discussion in the intended project with a clear subject or message.
2. Attach supporting files when the control is available, and check their intended visibility.
3. Mention invited project members when a message needs their attention. A mention does not grant project access.
4. Keep internal coordination private; explicitly share the client-facing discussion when appropriate.
5. Turn an actionable discussion into a task using the available conversion control, then assign its owner and date.
6. Record a consequential decision under Decisions with its date, decision maker, rationale, and source.
7. If the decision changes, mark the earlier record as superseded and link the replacement rather than silently erasing the history.

Audit findings have their own fields: evidence type, affected flow, severity, criterion, evidence, recommendation, owner, and validation result. Distinguish an observed issue from a hypothesis. Link the supporting source or file and update validation when the issue is retested.

Shared messages may return to internal review after staff edits. Clients can correct their own permitted replies, but they do not receive general editing rights over team records.

Expected result: delivery conversations remain readable, agreed decisions are traceable, and tasks represent work to perform rather than burying every action in a message thread.

## 16 | Creative review and approvals

Where: Projects > Review. Clients find published reviews under Feedback.

1. Upload the work to the project, then create a review with a title and the appropriate uploaded file.
2. Explain what the reviewer should evaluate and which decisions you need.
3. Add the intended approval route or reviewers where the controls are available.
4. Publish/share the review version and enable the project's approvals tool for the invited client.
5. Open the client preview and verify that the correct version and instructions appear.
6. Review comments and annotations on that exact version. Record or respond to the requested changes.
7. Upload a new version when the work changes. Do not overwrite the meaning of an earlier approval.
8. Confirm the latest version's decision before treating the deliverable as approved.

Feedback and decisions attach to a file version. Approval of version 1 does not approve version 2. A staged approval route can require one reviewer before another; inspect its status and available actions before proceeding.

If a client sees no review, check membership, the approvals tool, the published state, and whether the review has been archived or deleted. If they cannot respond, check that they are the intended reviewer for the current stage and version.

Expected result: a clear record of what was reviewed, who responded, and whether the latest work is approved or needs changes.

## 17 | Scope changes and project evidence

Where: Projects > Scope changes, Decisions, and Audit findings.

1. Choose Propose a scope change when a request adds or changes work outside the current agreement.
2. Enter a specific title and describe the extra work, exclusions, and assumptions.
3. Enter the proposed amount in USD and the additional days.
4. Select the approving reviewer and submit the proposal through the available action.
5. Wait for the recorded response. Discuss and revise the proposal if needed.
6. When approved, use the available conversion to create a draft estimate, then review and share that document through the document workflow.
7. Update the project plan, tasks, and dates separately after agreement.
8. Link relevant decisions and evidence so the reason for the change is clear later.

Approving a scope change does not automatically change deadlines, tasks, or invoices. A draft estimate is also not a verified payment. Keep those steps distinct so the project does not silently gain work or charges.

Project evidence reports bring selected records together for review. Before sharing an export, check its selected content and audience; an export is a copy outside the portal's live permission checks.

Expected result: the client and freelancer can trace a change from request to approval, commercial document, and revised delivery plan.

## 18 | Requests and public intake

Where: Requests. Administrators also see Public intake forms.

1. Open Requests and create a new request, or review a submission from a client.
2. Read the brief, requested service, timing, budget information, and any project association.
3. Record the next step using the status and action controls shown for your role.
4. When accepting work, select the project blueprint and project start date if the conversion flow offers them.
5. Review any resulting project and tasks before treating the request as scheduled delivery.
6. For prospects without accounts, create a public intake form with a title, introduction, and optional expiry date.
7. Copy the enabled form link and test it in a private browser session.
8. Pause, expire, or disable an intake link when you no longer want submissions.

Anyone with an enabled intake link can submit; the link does not grant access to workspace records. Public submissions require working bot verification and server configuration. The operator must set both Turnstile keys and the correct `PMS_PUBLIC_URL` hostname.

A request is a proposal for work. It does not automatically approve a price, sign an agreement, or collect a deposit. Continue through Documents & payments when commercial approval is needed.

Expected result: incoming work has a clear brief and owner, and accepted requests lead to deliberately reviewed projects.

## 19 | Blueprints and reusable delivery plans

Where: Blueprints, then a project's Plan tab.

1. Open a blueprint and read its description and ordered steps.
2. Review the phases, effort, roles, relative dates, dependencies, and deliverables it describes.
3. Choose the project that should receive the plan.
4. Map blueprint roles to invited project members when prompted.
5. Choose the plan start date and review the application preview.
6. Apply the blueprint once you have checked the generated work.
7. Open the project's Plan tab to inspect its applied-blueprint record.
8. Manage ongoing progress in Tasks and Scheduling rather than editing the blueprint to change existing work.

A reusable blueprint is a starting plan, not a promise that every engagement follows identical dates or effort. Review the result for the client's actual scope. Existing task templates in Workspace settings provide a simpler checklist option.

When revising a blueprint, distinguish the reusable definition from projects that already used it. Do not assume that changing the definition updates previously generated tasks. Inspect application history before applying it again to avoid duplicate work.

Expected result: repeated services start from a consistent structure while each project keeps its own assignments, dates, and delivery history.

## 20 | Time tracking and client time reports

Where: Time tracking, plus the selected project's client time-report controls.

1. Select the project and optionally a task in the timer.
2. Start tracking when work begins, stop when it ends, and review the saved description and duration.
3. Use manual entry for work recorded elsewhere. Enter the date, project, hours, description, and billable state.
4. Administrators can review the cost rate, bill rate, and billing coverage fields. Choose whether work needs billing review, is invoiced separately, or is covered by approved scope.
5. Submit and approve entries using the controls available to your role.
6. Correct an incorrect entry with Edit. Editing approved time returns it for submission/review.
7. Before invoicing, review approved billable entries and whether they are already covered by an agreement.
8. Enable a client time report only when you intend to share that view, then inspect it as the client.

The timer is stored in the browser for the user and workspace. Do not assume another browser has the same active timer. Regular users can manage their permitted submitted time; they cannot approve their own access to financial administration.

Deleting or denying an entry can be permanent depending on the action shown. A time edit can change retainer usage but does not rewrite an already issued invoice. Reconcile the financial record separately.

Expected result: hours, billing coverage, and approval state describe the actual work without charging the same time twice.

## 21 | Documents, agreements, and PDFs

Where: Documents & payments. Administrators prepare documents; the selected client responds to shared versions.

1. Create a document and choose its type: Estimate, Contract, Project agreement, Creative brief, Invoice, or Change order.
2. Choose a billing profile if appropriate, then verify the copied client name, email, address, and rate/tax defaults.
3. Set the document title, service, project association, proposed dates, and intended portal recipient.
4. Write the actual scope, deliverables, milestones, review rounds, exclusions, and terms. Replace every template instruction with your agreed details.
5. Enter line descriptions, quantities, and unit prices. Review tax treatment and totals.
6. Save the draft and preview/download its PDF. Check page breaks, business identity, recipient, amounts, and terms.
7. Share the document only after assigning the correct client recipient and reviewing the exact version.
8. Follow the client's response. Approved and discussion-requested states describe the shared version, not every future revision.

The inherited priced-document workflow uses a 50% deposit requirement. The PDF checks cover the calculation, but the operator must decide whether that commercial rule fits their business before use. Changing wording alone does not change calculations.

A typed-name approval records the client's stated agreement in this application. This guide does not establish its legal sufficiency for every engagement or location. Use terms appropriate to your work and retain the agreed version.

Expected result: a complete, versioned document whose PDF matches the portal view and whose recipient is the intended client.

## 22 | Payments and reconciled billing records

Where: Documents & payments, and Financials > Billing records.

1. Open the approved document and inspect its deposit or outstanding balance.
2. For an external payment, confirm the money was actually received in the payment provider or bank before recording it.
3. Enter the method, transaction reference, and received amount in Confirm an external payment.
4. Open Billing records to review the underlying obligation, source documents, and verified payment evidence.
5. Match a payment to an existing transaction only when the evidence shows they are the same payment.
6. Reconcile records only when they represent the same full obligation, and record the reason and source evidence.
7. Review net receipts, refunds, and unpaid commitments after reconciliation.
8. Open the source document to resolve any disagreement rather than editing totals to make them look correct.

A deposit-only invoice must not be merged with the full agreement as if they were identical obligations. An invoice and an estimate are not receipts. Recording a manual payment does not move money.

Square checkout appears only when enabled and configured. The client may see Square connection pending until then. Manual payment instructions can be configured through the available settings. Stripe support belongs to the legacy invoice adapter and needs its own configuration; it is not interchangeable with Square document checkout.

Expected result: each financial obligation and received payment can be traced to its source, with no duplicated revenue or deposit.

## 23 | Billing profiles, legacy invoices, budgets, and retainers

Where: Financials. Only administrators see the financial management area.

1. Open Billing profiles and choose a client billing account.
2. Enter its billing name, email, address, default hourly rate, tax rate, tax note, and relevant contacts.
3. Save the profile. Verify the copied values when creating a new document; profile edits do not change existing documents.
4. Use Billing records for reconciled totals. Invoices and Estimates also expose a legacy ledger whose totals are labeled separately.
5. To create a budget, open Budgets, choose New budget, select the project, and enter a positive amount.
6. Use Active, Archived, and Trash filters to locate an existing budget before creating another. A project has one budget record under the existing constraint.
7. Review retainer hours, usage, and rollover. Use Roll into next month to create the next period after checking unused hours.
8. Inspect time and payment evidence when a budget or retainer figure looks unexpected.

Do not add legacy-ledger totals to reconciled billing totals without checking whether they describe the same obligation. Budget archive/delete affects active budget calculations, not the project's historical time or invoice records.

A retainer tracks included hours and usage. It does not automatically charge a payment method. A budget is a planning limit; changing it does not amend a client agreement by itself.

Expected result: reusable billing details reduce re-entry while obligations, receipts, budgets, and hours remain separate and understandable.

## 24 | Recurring invoice drafts and reminders

Where: Financials > Billing automation.

1. Open Create recurring invoice schedule.
2. Choose a priced project invoice as the template.
3. Select weekly or monthly cadence, the invoice time zone, first date, optional last date, and days until payment is due.
4. Save the schedule and inspect the occurrence history.
5. Open each generated invoice draft, review its scope and amounts, and share it deliberately.
6. For an overdue approved invoice, open Configure invoice reminders.
7. Set its time zone, first reminder delay, interval, and maximum reminder count.
8. Review reminder and email history, and pause a schedule when it should stop.

Recurring schedules create private drafts. They do not share invoices, charge cards, or change agreement terms. Reminders use the reconciled balance, including verified receipts and refunds, rather than assuming the original amount is still unpaid.

Scheduled processing depends on the operator's job/worker deployment. A saved schedule is not proof that a background job is running. Use the available check action and occurrence history to verify processing. Email also requires a working connection and enabled notification delivery.

Expected result: automation prepares work for review and records what ran. It does not hide commercial decisions from the freelancer.

## 25 | Studio expenses, subscriptions, and receipt review

Where: Financials > Studio expenses.

1. Record an actual expense with the vendor, amount, currency, paid date, category, and supporting evidence fields shown.
2. Use year, period, category, and status filters to inspect the relevant spending.
3. Maintain subscriptions separately from payments. A subscription describes a recurring arrangement; it is not proof that a charge occurred.
4. Review forecasts separately from actual recorded spending.
5. If receipt sync is configured, connect only an authorized mailbox from the operator's allowlist.
6. Open each suggested receipt and verify the vendor, amount, currency, paid date, and related subscription against the original message.
7. Approve a suggestion only when it supports a real payment or the intended subscription update. Dismiss ambiguous reminders or unpaid invoices.
8. Review duplicate warnings and existing records before adding another expense.

Receipt detection can be incomplete. Several totals in one message, refunds, trial notices, and image-only receipts may need manual review. Email suggestions do not post payments automatically.

Pause stops future scheduled collection. Disconnect removes the stored connection token but does not automatically delete previously imported records. Recording or deleting a subscription here does not purchase or cancel the vendor's subscription.

Before using permanent Trash controls, read which records and stored evidence will be removed. Export needed records and follow your retention obligations.

Expected result: spending reflects verified payments, while subscription plans, forecasts, and unreviewed email suggestions remain distinguishable.

## 26 | Team capacity and resource bookings

Where: Team capacity and the project's Scheduling tools.

1. Select the date and schedule view for the period you need to plan.
2. Choose active people, paused people, archived people, or everyone, using the filters shown.
3. Set each person's working days and hours per working day where you have permission.
4. Record time off with the correct first and last day.
5. Create a resource booking by choosing the project, team member, date range, and hours per working day.
6. Mark tentative allocations appropriately and distinguish them from confirmed bookings.
7. Inspect daily demand, remaining availability, and overload warnings.
8. Adjust work or bookings after reviewing the related task schedule and project commitments.

Overlapping leave is counted without duplicating the same day. A paused or archived planning status is not the same as removing a person's workspace access. Change membership separately when access must end.

Bookings describe an allocation envelope for a project. Task estimates are not simply added on top of the same booked work. Additional effort outside the envelope can increase demand. Inspect the detail before assuming a warning means all hours are double-booked.

Expected result: a plan that reflects people who are actually available, with tentative commitments and time off visible before new work is promised.

## 27 | Studio insights and client profitability

Where: Studio insights and Client profitability. These views are restricted according to workspace role.

1. Select the workspace and period or filters available in the view.
2. Review active projects, work status, time, budgets, and other source measures.
3. Open the underlying project or record before acting on an unexpected value.
4. In Client profitability, compare billable value, recorded costs, and the relevant work or payment records.
5. Check cost rates, bill rates, approved hours, billing coverage, and expense evidence when a margin looks wrong.
6. Correct the source record and refresh the view.
7. If optional AI assistance is enabled, review its draft or summary before applying any recommendation.

Missing data is not the same as zero activity. Unrecorded time, a stale budget, or an unmatched receipt can change the result. These views support management decisions; they do not replace reconciled accounting records.

AI-generated suggestions require configured providers. A local calculation fallback is labeled when the model is unavailable. Enabling a hosted AI provider can send the requested project summary to that provider, so the operator must decide whether it fits their client-data arrangements.

Expected result: insights lead you back to evidence and a specific action, rather than presenting an unverified number as a complete business result.

## 28 | Optional website monitoring and connected tools

Where: Website Monitor. This is an administrator tool and is optional for the client portal.

1. Set the monitored website in `config/brand.json` and review the page paths in `lib/website-monitor.ts`.
2. Set `WEBSITE_MONITOR_WORKSPACE` to the workspace that owns the monitoring records.
3. Configure only the providers you intend to use, including `GA4_PROPERTY_ID`, `NETLIFY_SITE_ID`, and `SEARCH_CONSOLE_PROPERTY` where relevant.
4. Connect the corresponding authorized provider credentials through the supplied integration controls.
5. Run a check and read its timestamp, success state, and missing-data messages.
6. Review search periods and comparison windows before interpreting changes.
7. Review crawl findings, action items, and evidence before turning an observation into project work.
8. Configure competitors in `config/monitor-competitors.json` only if you need comparative evidence.

The article-monitor module retains a `/chronicles/` feed/path convention from the application. Adapt its paths and feed parsing to your own site before relying on article discovery. It does not automatically detect every CMS structure.

Task GitHub links and other connected-work features also need the operator's own repository access and server settings. Linking a URL is not proof that private repository metadata is connected.

The application preserves exact-domain restrictions and access checks. Do not remove them to make a provider request succeed. Fix the configured property, hostname, or credentials instead.

Expected result: optional integrations report real evidence from your own accounts without being required for ordinary project collaboration.

## 29 | Archive, Trash, and removing access

Where: record actions, archive filters, Trash tools, and Workspace settings.

1. Use Archive when work is finished but its records should remain.
2. Use the Archived filter to find and restore an archived record.
3. Read Delete confirmations carefully. Some records go to recoverable Trash; others have permanent delete or deny actions.
4. Use Trash filters to inspect recoverable records before restoring them.
5. Export or back up required data before any permanent deletion.
6. Remove a person's project membership to end access to that project.
7. Remove workspace membership when the person should no longer use that workspace.
8. Treat Delete workspace as a separate, broad action; review its confirmation and impact before proceeding.

Archive and Trash are lifecycle states, not permission revocation. A project may retain accessible history for people who still have access. Conversely, removing membership does not erase the person's historical contributions or accounts in other workspaces.

Stored files may require provider-side cleanup as part of deletion. Read the operation's result and resolve errors rather than assuming a failed upload/delete has completed. Back up the database and storage together so references and files remain consistent.

Expected result: finished work leaves active views, recoverable mistakes can be restored where supported, and access is removed through the actual membership controls.

## 30 | Client guide: first login and finding your work

This chapter is for the client receiving an invitation from a freelancer.

1. Open the portal URL from your invitation. Confirm that it is the studio you expected.
2. Sign in with your own email and initial password.
3. Complete the first-login password change if requested. Use Profile to update your name and security settings.
4. Start on Home. Review the next requested action, active work, and any agreement or review needing attention.
5. Choose Projects to open a project shared with you.
6. Select the appropriate project when you have more than one. On mobile, use the project picker.
7. Open Updates for notifications and Profile for account changes or sign-out.
8. Use the new-project/service request control when you want to propose additional work.

Your navigation contains Home, Projects, Documents, Messages, Updates, and Profile. A project can show Overview, Tasks, Files, Feedback, Timeline, People, Time report, Decisions, and Audit findings depending on what the studio enabled and shared.

If no project appears, contact the studio and ask them to check your project invitation. Creating an account alone does not make every project visible. If one section is missing, it may be intentionally disabled or contain no shared items.

Expected result: you can find the work assigned to your client account without seeing the freelancer's internal planning or another client's projects.

## 31 | Client guide: files, feedback, and messages

Where: Projects > select project, or Messages in the client navigation.

1. Read the project's Overview and shared brief to understand the current scope and status.
2. Open Files to view or download the files the studio has shared.
3. Open Feedback when a deliverable needs review. Check the version number before commenting.
4. Read the review instructions and inspect the file. Add clear comments or annotations using the controls offered.
5. Choose the available approval or change-request action only when it reflects your decision on that version.
6. Use Messages for questions and project discussion. Keep feedback on a specific version in its review thread where possible.
7. Read Timeline for dates or activity and People for the invited project team.
8. Inspect shared Decisions, Audit findings, or Time report if the studio has enabled them.

A missing file or task may still be internal. Ask the studio to share it; changing browser URLs does not grant access. If a download expires, return to Files and open it again.

Approval belongs to the exact file version you reviewed. If the studio uploads a new version, read it before approving again. A message saying something looks good is not a substitute for the application's explicit decision control when the studio requests one.

Expected result: the studio receives feedback tied to the right project and version, and you can see whether your response was saved.

## 32 | Client guide: documents and payments

Where: Documents in the client navigation.

1. Open the document shared with your account and check its title, version, studio identity, and client details.
2. Read the scope, deliverables, dates, line items, tax treatment, deposit, and terms.
3. Download the PDF if you need a copy for review or your records.
4. Under Your response, choose Approve this version or Request discussion.
5. Enter your full name. Add comments when requesting discussion, and confirm the authorization checkbox only if it is true.
6. Send response and verify the new status appears.
7. If payment is due, follow the displayed payment instructions or the enabled Square checkout.
8. Keep your payment reference and contact the studio if the portal's recorded balance does not match your payment.

Square connection pending means online checkout is not configured for that installation. It does not mean your card was charged. An external bank, wallet, or other payment must be verified and recorded by the studio.

A typed-name approval includes an explicit statement about your authority and agreement. Ask for clarification before submitting if any scope, price, or term is unclear. An approved version should be retained as the record of that response.

Expected result: your decision and any verified payment are attached to the intended document, and requests for discussion remain visible to the freelancer.

## 33 | Deploy your own hosted portal

This application needs a Node-compatible host and a working Supabase backend. GitHub Pages cannot run its server routes. The repository includes Netlify configuration and a Dockerfile; hosting and provider accounts belong to the operator.

1. Create a new Supabase project or a separate self-hosted instance. Do not reuse the demonstration database for client work.
2. Apply every file in `supabase/migrations/` in filename order. For the bundled Docker stack, use `sh scripts/migrate.sh`. For hosted Supabase, use a migration workflow that applies these SQL files and keeps a ledger; verify required extensions such as pg_cron are enabled.
3. Set the browser values `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for this new backend.
4. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` only in the server environment. Never put the service-role key in a `NEXT_PUBLIC_*` variable.
5. Set the public HTTPS portal address in both `config/brand.json` and `PMS_PUBLIC_URL`.
6. Configure Supabase Auth Site URL, allowed redirect URLs, and SMTP delivery for password recovery and email confirmation.
7. Deploy with the repository build command, `npm run build`. Netlify reads `netlify.toml`; a VPS needs a Node process or the Docker app profile behind HTTPS.
8. From a trusted operator environment, run the first-admin script against the new backend using its own private environment values. Do not run the demo seed.
9. Replace Privacy and Terms placeholders, check document terms, and create two fictional client accounts for access testing.
10. Test sign-in, recovery, client isolation, an upload/download, a review, and a PDF before inviting real clients.

Public environment values are embedded during the build. Rebuild after changing them. Keep database, Studio, and local-mail interfaces private. Configure backups and test a restore before relying on the deployment.

## 34 | Configure optional providers

Start with manual payments, Supabase storage, and in-app notifications. Add integrations one at a time and test each with fictional data.

1. For Google notifications, create your own OAuth application and set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and the exact `GOOGLE_OAUTH_REDIRECT_URI` ending in `/api/email/google/callback`.
2. Generate a private 32-byte base64 `EMAIL_TOKEN_ENCRYPTION_KEY`. Keep it stable while connections exist; changing it without reconnecting makes stored tokens unreadable.
3. Set `NOTIFICATION_SENDER` to the mailbox you authorize. Enable `ENABLE_NOTIFICATION_EMAIL_WORKER` only after the connection and delivery flow work.
4. For receipt review, set `EXPENSE_MAILBOXES` to a comma-separated allowlist, then connect each permitted mailbox from Studio expenses.
5. For public intake, configure `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, and the correct `PMS_PUBLIC_URL`.
6. For Square, set sandbox credentials first, the location, webhook URL/signature key, and `SQUARE_CHECKOUT_ENABLED`. Test the full provider return and webhook flow before live mode.
7. For Dropbox or S3-compatible storage, use your own application credentials and test workspace-scoped upload/download before changing the active provider.
8. For AI, use the local Ollama default or explicitly enable the supported hosted provider variables from `.env.example`.

MCP and worker services use `PMS_WORKSPACE_ID` and the user's short-lived `PMS_ACCESS_TOKEN`, not a service-role token. Restart or refresh credentials when the user's session expires. Scheduled jobs require an actual deployed worker or scheduler; a configuration flag alone does not execute them.

Optional providers were not live-tested for this template release. Review their current setup requirements and your data-handling commitments before enabling them.

## 35 | Backups, updates, and validation

Back up the database and storage together. A database export alone cannot restore files that only existed in a storage volume or external provider.

1. Record your deployed version or commit and keep a private inventory of server settings.
2. Schedule database backups using your hosting provider or PostgreSQL backup tools.
3. Include uploaded files, alternate-storage content, and the configuration needed to locate them.
4. Protect backup access and keep private secrets outside the public repository.
5. Restore a backup into an isolated environment and verify login, project records, and sample file downloads.
6. Before updating, back up again and review new migrations and release notes.
7. Install dependencies with `npm ci`, run checks, apply new migrations in order, and rebuild.
8. Verify the main client workflow after deployment and keep the prior deploy available when your platform supports rollback.

Useful local checks:

```sh
npm run typecheck
npm run test:template
node --import tsx scripts/check-client-portal.tsx
npm run test:documents
npm run build
```

The full browser suite requires the migrated and seeded test backend and Chrome. It creates test records. Never run it against real client data. The repository's integration workflow provides a separate route to those checks.

For this initial release, consult `docs/VERIFICATION.md` for exact results. A passing build or unit check does not establish complete accessibility, security certification, or successful live payment/email integration.

## 36 | Troubleshooting by symptom

Sign-in cannot reach the server: confirm Docker is running, inspect `docker compose ps`, and verify the Supabase URL and browser anon key. On a hosted app, changing local files does not change the deployed environment; rebuild with the correct public values.

An account does not exist: public registration is closed. Use the first-admin CLI for an empty installation or ask an administrator to create/add the account. Do not disable provisioning checks.

Password email never arrives: local development uses Mailpit on port 8025. Hosted recovery needs working SMTP, correct Site URL, and allowed redirects. Inspect provider logs without exposing tokens.

A client sees no project: check the workspace, explicit project invitation, enabled client tools, and item sharing. Use a real client session to verify. Administrator preview is only a convenience.

A shared item disappeared after editing: inspect whether the edit returned it to internal review. Recheck the content before sharing again.

Uploads fail or downloads expire: check allowed type/size, storage credentials and policies, and hosted request-size limits. Reopen an expired download from the portal.

Checkout is unavailable: inspect the selected provider's enabled flag and credentials. Manual recorded payments do not imply online checkout is configured.

A recurring invoice did not appear: inspect its date, time zone, pause state, occurrence history, and the scheduler/worker. Draft creation and email delivery are separate operations.

A build fails: use Node 24, run `npm ci`, read the first actual error, and check required hosted environment values. Do not publish `.env` or credentials in a bug report.

A port is occupied: identify which local service uses 3100 or 8000 before stopping anything. Existing studio installations may use the same ports. Run the template on an isolated environment or deliberately change the app, backend, Auth redirects, and test settings together.

## 37 | First-client launch checklist

Use fictional data for this rehearsal. Complete it from both the administrator and client accounts.

1. Confirm your studio name, support address, favicon, logo, portal URL, and new PDF identity.
2. Create one project, one task, an internal brief, and a separate shared brief.
3. Invite Client A to that project. Keep Client B outside it.
4. Enable only the necessary tools. Share one task and one file; keep a second task and file internal.
5. Sign in as Client A and confirm only shared content appears. Sign in as Client B and confirm the project is unavailable.
6. Publish a review version and submit a client response. Confirm the response is attached to that version.
7. Share a complete sample document, request discussion or approve it, and compare the PDF with the portal.
8. Record a fictional local-demo payment only in the test environment and inspect its billing evidence.
9. Test password recovery, MFA, mobile navigation, keyboard access, and the support contact.
10. Verify backups, restore instructions, privacy/terms content, and the status of optional email or payment providers.

Keep your own completion notes, deployment version, and unresolved issues. Remove fictional records from the appropriate test environment when finished; do not use broad database resets on a live installation.

You are ready to invite a real client when the actual hosted instance passes this rehearsal and its operator can explain where data is stored, who can access it, and how to recover it.
