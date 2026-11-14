# Contributing

Use a separate branch and keep changes focused. Describe the behavior before and after the change, include the commands you tested, and attach screenshots for visual changes.

Run `npm run typecheck`, `npm run test:template`, relevant existing checks, and `npm run build`. For database or permission changes, run the integration suite against an isolated seeded database. Add a migration instead of editing a migration already used by installations.

Keep branding in `config/brand.json`. Use fictional fixtures. Preserve workspace and project isolation, MFA checks, explicit content sharing, and server-only credentials. Include third-party licenses for any added assets.
