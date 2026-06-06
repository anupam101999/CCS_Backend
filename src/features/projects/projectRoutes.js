// routes/projectRoutes.js

const express = require("express");
const router = express.Router();

const {
  getProjectsByUserId,
} = require("./projectController");
const { requireSession } = require("../../middleware/requireSession");
const { requireFeatureAccess } = require("../../middleware/requireFeatureAccess");

router.get("/projects/:userId", requireSession, requireFeatureAccess("projects"), getProjectsByUserId);

module.exports = router;
