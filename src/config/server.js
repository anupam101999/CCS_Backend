require("./env");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const pool = require("./db");
const dbCreateQuery = require("../db/dbCreateQuery");
const customerRoutes = require("../features/customer/customerRoutes");
const adminRoutes = require("../features/admin/adminRoutes");
const uploadRoutes = require("../features/uploads/uploadRoutes");
const projectRoutes = require("../features/projects/projectRoutes");
const logger = require("../util/logger");
const {
  getTimeZone,
  localTimestamp,
  nextDailyRunTimestamp,
} = require("../util/time");
const { startDailyJobScheduler } = require("../services/dailyJobScheduler");
const { requestLogger } = require("../middleware/requestLogger");
const { requireAdmin } = require("../middleware/requireAdmin");
const { validateAuthConfig } = require("../core/security/authTokens");

const app = express();
const PORT = process.env.PORT || 5000;
app.set("trust proxy", 1);

const allowedOrigins = (
  process.env.FRONTEND_ORIGINS ||
  process.env.FRONTEND_URL ||
  ""
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable("x-powered-by");
app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      if (
        !origin ||
        allowedOrigins.length === 0 ||
        allowedOrigins.includes(origin)
      ) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS."));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Cache-Control",
      "Pragma",
      "X-View-As-User-Id",
    ],
  }),
);
app.use("/api", requestLogger);
app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use(express.json({ limit: "1mb" }));

app.use("/api/admin", adminRoutes);
app.use("/api", customerRoutes);
app.use("/api", uploadRoutes);
app.use("/api", projectRoutes);
app.use("/api/debug", requireAdmin, require("../services/mailerTest").router);

app.get("/", (_req, res) =>
  res.json({ status: "online", app: "CCS Backend", version: "3.1.0" }),
);

app.get("/health", (_req, res) =>
  res.json({
    status: "ok",
    time: localTimestamp(),
    timeZone: getTimeZone(),
  }),
);

app.use((err, _req, res, next) => {
  if (
    err?.message === "Only image files are allowed." ||
    err?.code === "LIMIT_FILE_SIZE"
  ) {
    logger.warn("upload.rejected", {
      reason: err.code === "LIMIT_FILE_SIZE" ? "file_too_large" : "invalid_file_type",
      errorMessage: err.message,
    });
    return res.status(400).json({
      message:
        err.code === "LIMIT_FILE_SIZE"
          ? "File must be under 5 MB."
          : err.message,
    });
  }
  return next(err);
});

app.use((_req, res) => res.status(404).json({ message: "Route not found." }));

app.use((err, _req, res, _next) => {
  logger.error("server.unhandled_error", err);
  return res.status(500).json({ message: "Internal server error." });
});

async function startServer() {
  try {
    validateAuthConfig();
    await dbCreateQuery();
    const server = app.listen(PORT, () => {
      const envName = process.env.NODE_ENV || "development";
      const timeZone = getTimeZone();
      const batchJobs = [
        {
          name: "CCS daily jobs",
          time: process.env.DAILY_JOBS_TASK_TIME || "02:00",
        },
      ];

      console.log(
        `CCS Backend server running on port ${PORT} in ${envName} mode`,
      );
      console.log(`Server started at ${localTimestamp()} (${timeZone})`);
      console.log("Batch jobs:");
      for (const job of batchJobs) {
        console.log(
          `- ${job.name}: daily at ${job.time} ${timeZone}; next run ${nextDailyRunTimestamp(job.time, timeZone)}; runs inside this server process`,
        );
      }
      logger.info("server.started", {
        port: PORT,
        envName,
        timeZone,
        dailyJobsTaskTime: process.env.DAILY_JOBS_TASK_TIME || "02:00",
      });
      startDailyJobScheduler();
    });

    function shutdown(signal) {
      console.log(`Received ${signal}; closing HTTP server and database pool`);
      server.close(async () => {
        try {
          await pool.end();
          console.log("Shutdown complete");
          process.exit(0);
        } catch (err) {
          logger.error("server.shutdown_failed", err);
          process.exit(1);
        }
      });
    }

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  } catch (err) {
    logger.error("server.start_failed", err);
    process.exit(1);
  }
}

startServer();
