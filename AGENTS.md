# Freelancer Client Portal

Next.js App Router, React, TypeScript, Supabase. Read the installed Next.js guides under `node_modules/next/dist/docs/` before changing framework behavior.

- Public branding belongs in `config/brand.json`; secrets belong in ignored environment files.
- Preserve workspace/project authorization, database RLS, MFA, and invitation checks.
- Use fictional fixtures and reserved example/test domains in tests.
- Run `npm run typecheck`, `npm run test:template`, and relevant behavior checks before committing.
- Never commit credentials, database exports, client uploads, or local deployment links.
- Keep writing plain and specific. Do not claim an integration was tested unless it ran.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
