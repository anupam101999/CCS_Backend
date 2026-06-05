const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

function resolveEnvFile() {
  if (process.env.ENV_FILE) {
    return process.env.ENV_FILE;
  }

  const preferred =
    process.env.NODE_ENV === "production" ? ".env.production" : ".env.local";
  const preferredPath = path.resolve(process.cwd(), preferred);

  return fs.existsSync(preferredPath) ? preferred : ".env";
}

const envFile = resolveEnvFile();
const externalEnvKeys = new Set(Object.keys(process.env));

dotenv.config({
  path: path.resolve(process.cwd(), ".env"),
  override: false,
});

if (envFile !== ".env") {
  const overlayPath = path.resolve(process.cwd(), envFile);
  if (fs.existsSync(overlayPath)) {
    const overlay = dotenv.parse(fs.readFileSync(overlayPath));
    for (const [key, value] of Object.entries(overlay)) {
      if (!externalEnvKeys.has(key)) process.env[key] = value;
    }
  }
}

module.exports = { envFile, isProduction: envFile === ".env.production" };
