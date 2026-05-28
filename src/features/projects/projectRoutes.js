// routes/projectRoutes.js

const express = require("express");
const router = express.Router();

const {
  getProjectsByUserId,
} = require("./projectController");
const { requireSession } = require("../../middleware/requireSession");

router.get("/projects/:userId", requireSession, getProjectsByUserId);

module.exports = router;
