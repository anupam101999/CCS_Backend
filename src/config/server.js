require("dotenv").config();
const express = require("express");
const cors = require("cors");

const dbCreateQuery = require("../db/dbCreateQuery");
const userRoute = require("../routes/baseFunc");
const adminRoutes = require("../routes/adminRoutes");

const app = express();
const PORT = process.env.PORT || 5000;

// ← Must be FIRST before any routes
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json());

// ← Routes come AFTER middleware
app.use("/api/admin", adminRoutes);
app.use("/api", userRoute);

app.get("/", (_req, res) =>
  res.json({ status: "✅ online", app: "CCS Backend", version: "3.0.0" })
);

app.get("/health", (_req, res) =>
  res.json({ status: "ok", time: new Date().toISOString() })
);

app.use((_req, res) => res.status(404).json({ message: "Route not found." }));

app.listen(PORT, async () => {
  console.log(`🚀 Server on port ${PORT}`);
  await dbCreateQuery();
});