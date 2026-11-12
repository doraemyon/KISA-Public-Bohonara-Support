import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment value: ${name}`);
  return value;
}

function bounded(name, fallback, minimum, maximum) {
  const raw = process.env[name]?.trim();
  if (!raw) return String(fallback);
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be an integer.`);
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return String(value);
}

const databaseId = required("CLOUDFLARE_D1_DATABASE_ID");
if (!/^[0-9a-f-]{32,36}$/i.test(databaseId)) {
  throw new Error("CLOUDFLARE_D1_DATABASE_ID does not look like a D1 database ID.");
}

const botUsername = required("BOT_USERNAME").replace(/^@/, "");
if (!/^[A-Za-z0-9_]{5,32}$/.test(botUsername)) {
  throw new Error("BOT_USERNAME is not a valid Telegram bot username.");
}

const publicBaseUrl = new URL(
  process.env.PUBLIC_BASE_URL?.trim() || "https://kisa.bohonara.workers.dev",
);
if (
  publicBaseUrl.protocol !== "https:" || publicBaseUrl.username || publicBaseUrl.password ||
  publicBaseUrl.pathname !== "/" || publicBaseUrl.search || publicBaseUrl.hash ||
  publicBaseUrl.hostname.endsWith(".github.io")
) {
  throw new Error("PUBLIC_BASE_URL must be the HTTPS origin of the public Worker.");
}

const template = JSON.parse(
  await readFile(new URL("../wrangler.template.json", import.meta.url), "utf8"),
);
template.vars.BOT_USERNAME = botUsername;
template.vars.PUBLIC_BASE_URL = publicBaseUrl.origin;
template.vars.MAX_SUBSCRIBERS = bounded("MAX_SUBSCRIBERS", 50, 1, 500);
template.vars.BROADCAST_BATCH_SIZE = bounded("BROADCAST_BATCH_SIZE", 20, 1, 20);
template.vars.MAX_PENDING_APPLICATIONS = bounded(
  "MAX_PENDING_APPLICATIONS",
  100,
  1,
  500,
);
template.vars.MAX_APPLICATIONS_PER_HOUR = bounded(
  "MAX_APPLICATIONS_PER_HOUR",
  20,
  1,
  60,
);
template.vars.ADMIN_NOTIFICATION_BATCH_SIZE = bounded(
  "ADMIN_NOTIFICATION_BATCH_SIZE",
  5,
  1,
  5,
);
template.d1_databases[0].database_name =
  process.env.CLOUDFLARE_D1_DATABASE_NAME?.trim() || "kisa-public-bohonara-support";
template.d1_databases[0].database_id = databaseId;
if (process.env.ENABLE_CRON?.trim().toLowerCase() !== "true") {
  delete template.triggers;
}

const outputDirectory = path.resolve(".wrangler");
await mkdir(outputDirectory, { recursive: true });
await writeFile(
  path.join(outputDirectory, "deploy.jsonc"),
  `${JSON.stringify(template, null, 2)}\n`,
  "utf8",
);
console.log("Rendered Cloudflare deployment configuration.");
