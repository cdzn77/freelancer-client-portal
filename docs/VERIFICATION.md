# Release verification

Release: 0.1.0, November 14, 2026.

## Executed locally

- Clean dependency installation using the committed lockfile.
- TypeScript check and production build.
- White-label rendering, document identity, outgoing email identity, reply-domain boundaries, exact website citations, and Turnstile hostname checks.
- First-administrator bootstrap tests: provisioned identity, authenticated workspace creation, refusal of an existing owner, fail-closed count lookup, rollback after failure, and HTTPS requirement.
- Client portal checks: project isolation, enabled tools, shared content, mobile selection, approvals, and empty state.
- All 36 service/document template combinations, required fields, 50% deposit calculations, and standard/long PDF rendering.
- Account-security and recovery/MFA behavior checks, member invitation UI, connected-work checks, expense-email parsing and UI, search and website-monitor behavior checks, dashboard/calendar controls, startup, and request onboarding.
- Desktop (1440 px) and mobile (390 px) sign-in browser smoke checks, public-page branding, no horizontal mobile overflow, and no uncaught browser errors.
- PDF guide: 40 pages, 37 bookmarks, selectable text, clickable contents, extracted-text bounds, and visual review of selected pages.
- Release source scan for original deployment identity, private paths, private keys, common provider tokens, and JWTs. No matching private material in release source.

## Not executed locally

Docker was not running on the authoring machine. Full backend migrations, a real first-admin provision, database RLS integration tests, and authenticated end-to-end browser flows were not exercised against a fresh database in this local session. Bootstrap and UI behavior checks use isolated test doubles.

Live SMTP/OAuth delivery, payment capture/webhooks, alternate storage providers, hosted AI, and a production deployment were not tested. Operators must configure and verify their own accounts. Automated accessibility checks do not establish complete WCAG conformance.

The fast GitHub workflow passed for the initial release: https://github.com/cdzn77/freelancer-client-portal/actions/runs/43652516497. It runs build and template checks. The separate Full integration checks workflow starts an isolated backend for the broader suite when manually dispatched. Check its actual result before relying on it; inclusion of a workflow is not evidence that it passed.
