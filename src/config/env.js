const path = require("path");
const dotenv = require("dotenv");

const envFile =
  process.env.ENV_FILE ||
  (process.env.NODE_ENV === "production" ? ".env.prod" : ".env.local");

dotenv.config({
  path: path.resolve(process.cwd(), envFile),
  override: false,
});

module.exports = { envFile };
