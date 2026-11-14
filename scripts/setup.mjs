import fs from "node:fs";
import crypto from "node:crypto";
if (fs.existsSync(".env")) {
  console.log("Existing .env preserved.");
  process.exit(0);
}
const secret = crypto.randomBytes(40).toString("hex");
const jwt = (role) => {
  const a = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ),
    b = Buffer.from(
      JSON.stringify({
        role,
        iss: "supabase",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 10 * 365 * 86400,
      }),
    ).toString("base64url");
  return `${a}.${b}.${crypto.createHmac("sha256", secret).update(`${a}.${b}`).digest("base64url")}`;
};
const anon = jwt("anon"),
  service = jwt("service_role");
const values = {
  LOGFLARE_PUBLIC_ACCESS_TOKEN: crypto.randomBytes(32).toString("hex"),
  LOGFLARE_PRIVATE_ACCESS_TOKEN: crypto.randomBytes(32).toString("hex"),
  JWT_SECRET: secret,
  ANON_KEY: anon,
  SERVICE_ROLE_KEY: service,
  POSTGRES_PASSWORD: crypto.randomBytes(24).toString("hex"),
  DASHBOARD_PASSWORD: crypto.randomBytes(24).toString("hex"),
  SECRET_KEY_BASE: crypto.randomBytes(48).toString("hex"),
  VAULT_ENC_KEY: crypto.randomBytes(16).toString("hex"),
  REALTIME_DB_ENC_KEY: crypto.randomBytes(8).toString("hex"),
  PG_META_CRYPTO_KEY: crypto.randomBytes(32).toString("hex"),
  S3_PROTOCOL_ACCESS_KEY_ID: crypto.randomBytes(16).toString("hex"),
  S3_PROTOCOL_ACCESS_KEY_SECRET: crypto.randomBytes(32).toString("hex"),
  OPENAI_API_KEY: "",
  SITE_URL: "http://localhost:3100",
  SUPABASE_PUBLIC_URL: "http://127.0.0.1:8000",
  API_EXTERNAL_URL: "http://127.0.0.1:8000/auth/v1",
  API_GW_HTTP_PORT: "127.0.0.1:8000",
  SMTP_HOST: "mailpit",
  SMTP_PORT: "1025",
  SMTP_USER: "",
  SMTP_PASS: "",
  ENABLE_EMAIL_AUTOCONFIRM: "true",
  ENABLE_PHONE_SIGNUP: "false",
  FUNCTIONS_VERIFY_JWT: "true",
  POOLER_TENANT_ID: "freelancer-studio",
};
let env = fs.readFileSync("infra/supabase/env.template", "utf8");
for (const [k, v] of Object.entries(values))
  env = env.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`);
env +=
  "\nNEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:8000\nNEXT_PUBLIC_SUPABASE_ANON_KEY=" +
  anon +
  "\nSUPABASE_URL=http://127.0.0.1:8000\nSUPABASE_SERVICE_ROLE_KEY=" +
  service +
  "\nAI_PROVIDER=ollama\nOLLAMA_URL=http://127.0.0.1:11434\nOLLAMA_MODEL=llama3.2\nENABLE_PAID_AI=false\nENABLE_PAYMENTS=false\n";
fs.writeFileSync(".env", env, { mode: 0o600 });
fs.writeFileSync(
  ".env.local",
  "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:8000\nNEXT_PUBLIC_SUPABASE_ANON_KEY=" +
    anon +
    "\n",
  { mode: 0o600 },
);
console.log("Generated private local configuration.");
