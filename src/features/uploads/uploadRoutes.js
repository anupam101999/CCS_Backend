// routes/uploadRoutes.js

const router = require("express").Router();

const {
  upload,
  uploadFile,
  getUseravatarurl,
  uploadUseravatarurl,
  uploadProjectPhoto,
} = require("./uploadController");
const { requireSession } = require("../../middleware/requireSession");
const { requireAdmin } = require("../../middleware/requireAdmin");

router.post("/upload", requireSession, upload.single("file"), uploadFile);
router.post(
  "/admin/project-photo",
  requireAdmin,
  upload.array("files", 10),
  uploadProjectPhoto,
);
router.get("/user/avatarurl", requireSession, getUseravatarurl);
router.post("/user/avatarurl", upload.single("file"), uploadUseravatarurl);

module.exports = router;
