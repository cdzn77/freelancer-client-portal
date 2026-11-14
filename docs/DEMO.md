# Public demo

[Open the interactive demo](https://freelancer-client-portal-demo.netlify.app).

No account or installation is needed. Use **Freelancer** and **Client view** at the top to explore both perspectives. Open a project, inspect its tasks, browse the sample documents, or try adding a task. **Reset demo** restores the original records; reloading does the same.

Every name, project, record, and amount is fictional. Changes exist only in that browser tab's memory. They are not saved to a server or shared with other visitors.

The demo uses the application's existing React screens and styles, bundled separately with an in-memory data adapter. It is a product walkthrough, not a hosted account. It does not run the production database, authorization, or integration services. Email, payments, uploads, authentication changes, AI, and external integrations are unavailable. Actions that require those services display a demo notice.

To use the portal for real client work, follow the [installation guide](USER-GUIDE.md) and configure your own database, authentication, hosting, and services.

## Build and verify the demo

```sh
npm ci
npm run build:demo
npm run test:demo
npm run test:demo:browser
```

The browser check requires Chrome and starts its own temporary local server. It checks desktop and mobile views, navigation, task creation, reset behavior, and requests made by the page. Set `DEMO_URL` to check an existing deployment.

The build writes `demo-dist/`, which is ignored by Git. It substitutes the browser-only adapter for both Supabase client imports, rejects a bundle containing real backend modules, and does not copy environment files or server routes. The demo's response headers block network connections from its scripts. The production application and its authorization checks are unchanged.

## Publish an update

Build and test first. Publish only the contents of `demo-dist/` to a static host. The demo is a separate Netlify project named `freelancer-client-portal-demo`; do not link it to an existing studio or client portal site.

The current deployment is manual. A GitHub push alone does not update it. The main `netlify.toml` configures the full Next.js application, so use the static demo configuration in `demo/netlify.toml` when deploying the demo. Local Netlify state remains ignored by Git.
