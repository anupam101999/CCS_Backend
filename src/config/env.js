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

dotenv.config({
  path: path.resolve(process.cwd(), ".env"),
  override: false,
});

dotenv.config({
  path: path.resolve(process.cwd(), envFile),
  override: true,
});

module.exports = { envFile, isProduction: envFile === ".env.production" };
