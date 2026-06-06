// routes/projectRoutes.js

const express = require("express");
const router = express.Router();

const {
  getProjectsByUserId,
} = require("./projectController");
const { requireSession } = require("../../middleware/requireSession");
const { requireFeatureAccess } = require("../../middleware/requireFeatureAccess");

const requireProjects = requireFeatureAccess("projects");

router.get("/projects/:userId", requireSession, requireProjects, getProjectsByUserId);

module.exports = router;
