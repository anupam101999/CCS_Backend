require("./env");
const { Pool } = require("pg");
const logger = require("../util/logger");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.DB_POOL_MAX || 1),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 10000),
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 5000),
  allowExitOnIdle: true,
});

let hasLoggedConnection = false;

pool.on("connect", () => {
  if (!hasLoggedConnection) {
    logger.info("db.connected");
    hasLoggedConnection = true;
  }
});

pool.on("error", (err) => {
  logger.error("db.idle_client_error", err);
});

module.exports = pool;
