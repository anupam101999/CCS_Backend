require("dotenv").config();
const express = require("express");
const cors = require("cors");
const initDB = require("../db/init");
const introspect = require("../config/introspect");
const authRoutes = require("../routes/baseFunc");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get(
  "/",
  (_req, res) =>
    console.log(`✅ Server running on port ${PORT}`) ||
    res.json({ status: "✅ online", app: "CCS Backend", version: "3.0.0" }),
);
app.get("/health", (_req, res) =>
  res.json({ status: "ok", time: new Date().toISOString() }),
);

app.use("/api", authRoutes);

app.use((_req, res) => res.status(404).json({ message: "Route not found." }));

app.listen(PORT, async () => {
  console.log(`🚀 Server on port ${PORT}`);
  await initDB();
  await introspect();
});
