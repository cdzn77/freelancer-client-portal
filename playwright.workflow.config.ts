import { defineConfig } from "@playwright/test";
import fs from "node:fs";
if (fs.existsSync(".env")) process.loadEnvFile(".env");
export default defineConfig({
  testDir: "./tests",
  testMatch: ["studio-workflows.spec.ts", "permissions.spec.ts"],
  grepInvert: /through the interface/,
  workers: 1,
  timeout: 60000,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3101" },
});
