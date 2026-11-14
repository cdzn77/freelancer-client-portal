import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "demo-dist");
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });
const cssFiles = ["globals.css", "brand.css", "obrack.css", "search-intelligence.css", "white-label.css"];
let css = "";
for (const name of cssFiles) css += await fs.readFile(path.join(root, "app", name), "utf8") + "\n";
const compiled = await postcss([tailwind({ base: root, optimize: true })]).process(css, { from: path.join(root, "app/globals.css") });
await fs.writeFile(path.join(out, "portal.css"), compiled.css);
await build({
  absWorkingDir: root, entryPoints: ["demo/main.tsx"], bundle: true, minify: true, sourcemap: false,
  outdir: out, entryNames: "demo", assetNames: "assets/[name]-[hash]", format: "esm", platform: "browser", target: "es2022",
  loader: { ".woff2": "file", ".woff": "file", ".ttf": "file" },
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  alias: { "@/lib/supabase": path.join(root, "demo/backend.ts"), "@supabase/supabase-js": path.join(root, "demo/backend.ts") },
  metafile: true,
}).then(result => {
  // The shipped demo must not include the live backend client or any server route.
  const forbidden = Object.keys(result.metafile.inputs).filter(file => file === "lib/supabase.ts" || file.startsWith("app/api/") || file.includes("@supabase/"));
  if (forbidden.length) throw Error("Unexpected backend modules: " + forbidden.join(", "));
});
for (const dir of ["brand", "shapes", "fonts", "help"]) {
  try { await fs.cp(path.join(root, "public", dir), path.join(out, dir), { recursive: true }); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
await fs.cp(path.join(root, "node_modules/@fontsource-variable/inter/LICENSE"), path.join(out, "fonts/Inter-LICENSE.txt"));
await fs.cp(path.join(root, "LICENSE"), path.join(out, "LICENSE.txt"));
await fs.writeFile(path.join(out, "index.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Freelancer Client Portal — Interactive Demo</title><meta name="description" content="Explore a white-label freelancer workspace with fictional projects and a client portal. No account required."><link rel="icon" href="/brand/favicon.svg"><link rel="stylesheet" href="/portal.css"><link rel="stylesheet" href="/demo.css"></head><body><div id="root"></div><script type="module" src="/demo.js"></script></body></html>`);
await fs.writeFile(path.join(out, "_headers"), `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  X-Robots-Tag: noindex, nofollow
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'none'
  Cache-Control: public, max-age=0, must-revalidate
`);
await fs.writeFile(path.join(out, "_redirects"), "/* /index.html 200\n");
console.log("Built isolated browser-only demo in demo-dist/.");
