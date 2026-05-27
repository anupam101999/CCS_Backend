const path = require("path");
const dotenv = require("dotenv");

const envFile = process.env.ENV_FILE || ".env";

dotenv.config({
  path: path.resolve(process.cwd(), envFile),
  override: false,
});

module.exports = { envFile };
