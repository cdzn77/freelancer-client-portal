import { test } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
test("Studio expense PDF authorization and exact selection", async () => {
  await promisify(execFile)(
    process.execPath,
    ["scripts/check-expense-api.mjs"],
    {
      env: { ...process.env, EXPENSE_TEST_URL: "http://127.0.0.1:3100" },
      timeout: 50000,
    },
  );
});
