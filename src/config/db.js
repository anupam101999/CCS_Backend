require("./env");
const { Pool, types } = require("pg");
const { getTimeZone, localTimestamp } = require("../util/time");

const PG_TYPE_DATE = 1082;
const PG_TYPE_TIMESTAMP = 1114;
const PG_TYPE_TIMESTAMPTZ = 1184;

function parseDate(value) {
  return value || null;
}

function parseTimestamp(value) {
  if (!value) return null;
  const normalized = String(value).replace(" ", "T");
  const withOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized)
    ? normalized
    : `${normalized}+05:30`;
  const parsed = new Date(withOffset);
  return Number.isNaN(parsed.getTime()) ? value : localTimestamp(parsed);
}

types.setTypeParser(PG_TYPE_DATE, parseDate);
types.setTypeParser(PG_TYPE_TIMESTAMP, parseTimestamp);
types.setTypeParser(PG_TYPE_TIMESTAMPTZ, parseTimestamp);

function readNumber(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

const poolHardMax = readNumber("DB_POOL_HARD_MAX", 5, { min: 1 });
const poolMax = readNumber("DB_POOL_MAX", 1, { min: 1, max: poolHardMax });

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
  options: `-c timezone=${getTimeZone()}`,
  max: poolMax,
  idleTimeoutMillis: readNumber("DB_IDLE_TIMEOUT_MS", 5000, { min: 1000 }),
  connectionTimeoutMillis: readNumber("DB_CONNECTION_TIMEOUT_MS", 5000, { min: 1000 }),
  maxLifetimeSeconds: readNumber("DB_MAX_LIFETIME_SECONDS", 60, { min: 0 }),
  allowExitOnIdle: true,
});

let hasLoggedConnection = false;

pool.on("connect", () => {
  const timeZone = getTimeZone();

  if (!hasLoggedConnection) {
    console.log(JSON.stringify({
      level: "info",
      event: "db.connected",
      timeZone,
      poolMax,
      idleTimeoutMillis: pool.options.idleTimeoutMillis,
      maxLifetimeSeconds: pool.options.maxLifetimeSeconds,
    }));
    hasLoggedConnection = true;
  }
});

pool.on("error", (err) => {
  console.error(JSON.stringify({
    level: "error",
    event: "db.idle_client_error",
    errorCode: err?.code,
    errorName: err?.name,
    errorMessage: err?.message,
  }));
});

pool.withClient = async function withClient(callback) {
  const client = await pool.connect();

  try {
    return await callback(client);
  } finally {
    client.release();
  }
};

pool.withTransaction = async function withTransaction(callback) {
  return pool.withClient(async (client) => {
    await client.query("BEGIN");

    try {
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }
  });
};

module.exports = pool;
