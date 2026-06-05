// routes/uploadRoutes.js

const router = require("express").Router();

const {
  upload,
  uploadFile,
  getUseravatarurl,
  uploadUseravatarurl,
  uploadProjectPhoto,
  uploadTicketPhotos,
} = require("./uploadController");
const { requireSession } = require("../../middleware/requireSession");
const { requireAdmin } = require("../../middleware/requireAdmin");
const { publicUploadLimiter } = require("../../middleware/authRateLimits");

router.post("/upload", requireSession, upload.single("file"), uploadFile);
router.post(
  "/upload/ticket-photos",
  requireSession,
  upload.array("files", 5),
  uploadTicketPhotos,
);
router.post(
  "/upload/appointment-photos",
  requireSession,
  upload.array("files", 5),
  uploadTicketPhotos,
);
router.post(
  "/admin/project-photo",
  requireAdmin,
  upload.array("files", 10),
  uploadProjectPhoto,
);
router.get("/user/avatarurl", requireSession, getUseravatarurl);
router.post(
  "/user/avatarurl/profile",
  requireSession,
  upload.single("file"),
  uploadUseravatarurl,
);
router.post(
  "/user/avatarurl",
  publicUploadLimiter,
  upload.single("file"),
  uploadUseravatarurl,
);

module.exports = router;
