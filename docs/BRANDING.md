# Branding your installation

Edit `config/brand.json`, then rebuild and redeploy. These are public settings and are included in the browser bundle.

| Setting | Used for |
| --- | --- |
| `appName` | Application titles, public pages, invitations, MFA issuer |
| `name` | Studio name, text wordmark, document provider name, email identity |
| `ownerName` | Default document signer |
| `email` | Public support address and default notification sender |
| `websiteUrl` | Public website links and the optional monitoring domain |
| `portalUrl` | Full URL of this installation and payment return destination |
| `logoPath` | Optional path such as `/brand/logo.svg`; empty uses a text wordmark |
| `faviconPath` | Favicon asset under `public/` |
| `tagline` | Sign-in footer |
| `accentColor`, `accentTextColor` | Primary button background and text colors |

Use absolute HTTPS URLs for a hosted installation. Keep colors readable and test long studio names on mobile. Put your own logo in `public/brand/`. PDF headers use the configured studio name as text so a browser SVG does not break document rendering.

Set `PMS_PUBLIC_URL` to the same hosted portal address. Set `NOTIFICATION_SENDER` to the Google mailbox you actually authorize. `EXPENSE_MAILBOXES` is a comma-separated allowlist for optional receipt connections; it is empty by default. Private tokens and provider credentials go in the server environment, never the brand JSON.

The service catalog and example agreement wording are in `lib/service-catalog.ts`, `lib/document-templates.ts`, and `lib/client-documents.ts`. Check them against your services and commercial terms before sharing a document. Review existing documents separately: changing defaults does not rewrite saved records.

Replace `app/privacy/page.tsx` and `app/terms/page.tsx` with your own policies. Those pages are deliberately labeled placeholders. Review `app/about/page.tsx` if you disable optional features.

Advanced website monitoring uses your `websiteUrl`, `GA4_PROPERTY_ID`, `NETLIFY_SITE_ID`, `SEARCH_CONSOLE_PROPERTY`, and `WEBSITE_MONITOR_WORKSPACE`. Review `config/monitor-competitors.json`, page paths in `lib/website-monitor.ts`, and the article-feed settings in the monitoring modules for your own site. This module is optional; the core portal does not need it.
