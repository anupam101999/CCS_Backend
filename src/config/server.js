require("./env");
const express = require("express");
const cors = require("cors");

const dbCreateQuery = require("../db/dbCreateQuery");
const customerRoutes = require("../features/customer/customerRoutes");
const adminRoutes = require("../features/admin/adminRoutes");
const uploadRoutes = require("../features/uploads/uploadRoutes");
const projectRoutes = require("../features/projects/projectRoutes");
const logger = require("../util/logger");
const { requestLogger } = require("../middleware/requestLogger");


const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = (process.env.FRONTEND_ORIGINS || process.env.FRONTEND_URL || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable("x-powered-by");
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
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
app.use(express.json({ limit: "1mb" }));

app.use("/api/admin", adminRoutes);
app.use("/api", customerRoutes);
app.use("/api", uploadRoutes);
app.use("/api", projectRoutes);

app.get("/", (_req, res) =>
  res.json({ status: "✅ online", app: "CCS Backend", version: "3.0.0" }),
);

app.get("/health", (_req, res) =>
  res.json({ status: "ok", time: new Date().toISOString() }),
);

app.use((err, _req, res, next) => {
  if (err?.message === "Only image files are allowed." || err?.code === "LIMIT_FILE_SIZE") {
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
    await dbCreateQuery();
    app.listen(PORT, () => {
      logger.info("server.started", { port: PORT });
    });
  } catch (err) {
    logger.error("server.start_failed", err);
    process.exit(1);
  }
}

startServer();
