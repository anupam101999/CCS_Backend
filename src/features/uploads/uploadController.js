// controllers/uploadController.js

const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");
const ws = require("ws");
const crypto = require("crypto");
const path = require("path");
const pool = require("../../config/db");
const logger = require("../../util/logger");
const { sendNotificationToUser } = require("../../services/notificationEvents");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
  fileFilter(_req, file, cb) {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed."));
    }
    cb(null, true);
  },
});

function safeFileName(originalName = "upload") {
  const ext = path.extname(originalName).toLowerCase().replace(/[^.\w]/g, "");
  return `${Date.now()}-${crypto.randomUUID()}${ext}`;
}

function safeFolderName(name = "project") {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "project";
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  {
    realtime: {
      transport: ws,
    },
  },
);

/* ──────────────────────────────────────────────────────────────
   Generic File Upload
────────────────────────────────────────────────────────────── */
const uploadFile = async (req, res) => {
  try {
    if (!req.file) {
      logger.warn("upload.generic_rejected", { reason: "missing_file", userId: req.user?.id });
      return res.status(400).json({
        error: "No file uploaded",
      });
    }

    const file = req.file;
    const fileName = safeFileName(file.originalname);

    const { error } = await supabase.storage
      .from("uploads")
      .upload(`documents/${fileName}`, file.buffer, {
        contentType: file.mimetype,
      });

    if (error) {
      logger.warn("upload.generic_storage_rejected", {
        userId: req.user?.id,
        fileName,
        errorMessage: error.message,
      });
      return res.status(400).json(error);
    }

    const { data: publicData } = supabase.storage
      .from("uploads")
      .getPublicUrl(`documents/${fileName}`);

    logger.info("upload.generic_completed", {
      userId: req.user?.id,
      fileName,
      mimetype: file.mimetype,
      size: file.size,
    });

    return res.json({
      success: true,
      url: publicData.publicUrl,
    });
  } catch (err) {
    logger.error("upload.generic_failed", err);

    return res.status(500).json({
      error: "Upload failed",
    });
  }
};

/* ──────────────────────────────────────────────────────────────
   Get User avatarurl
────────────────────────────────────────────────────────────── */
const getUseravatarurl = async (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    logger.warn("upload.avatar_lookup_rejected", { reason: "missing_user_id", userId: req.user?.id });
    return res.status(400).json({
      message: "userId is required.",
    });
  }

  try {
    const { rows } = await pool.query(
      `SELECT avatarurl FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );

    logger.info("upload.avatar_lookup_completed", {
      requesterId: req.user?.id,
      userId,
      found: Boolean(rows[0]?.avatarurl),
    });

    return res.json({
      avatarurl: rows[0]?.avatarurl || null,
    });
  } catch (err) {
    logger.error("upload.avatar_lookup_failed", err, { userId });

    return res.status(500).json({
      message: "Could not fetch avatarurl.",
    });
  }
};

/* ──────────────────────────────────────────────────────────────
   Upload User avatarurl
────────────────────────────────────────────────────────────── */
const uploadUseravatarurl = async (req, res) => {
  try {
    const file = req.file;
    const userId = req.user?.id
      ? String(req.user.id)
      : `temp-${crypto.randomUUID()}`;
    if (!file) {
      logger.warn("upload.avatar_rejected", { reason: "missing_file", userId });
      return res.status(400).json({ message: "No file uploaded." });
    }

    if (!file.mimetype.startsWith("image/")) {
      logger.warn("upload.avatar_rejected", { reason: "invalid_file_type", userId, mimetype: file.mimetype });
      return res.status(400).json({ message: "Only image files are allowed." });
    }

    const fileName = `avatarurls/${userId}-${safeFileName(file.originalname)}`;

    const { error } = await supabase.storage
      .from("uploads")
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });

    if (error) throw error;

    const { data } = supabase.storage.from("uploads").getPublicUrl(fileName);

    logger.info("upload.avatar_completed", {
      userId,
      mimetype: file.mimetype,
      size: file.size,
    });

    return res.json({ avatarurl: data.publicUrl });
  } catch (err) {
    logger.error("upload.avatar_failed", err, { userId: req.body?.userId });
    return res.status(500).json({ message: "Upload failed." });
  }
};

const MAX_PROJECT_PHOTOS = 5;
const MAX_PROJECT_PHOTO_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024;

const uploadTicketPhotos = async (req, res) => {
  try {
    const files = req.files || [];
    const userId = req.user?.id;

    if (!files.length) return res.status(400).json({ message: "No files uploaded." });
    if (files.length > MAX_ATTACHMENTS) return res.status(400).json({ message: "You can upload up to 5 photos." });

    const urls = [];
    for (const file of files) {
      if (!file.mimetype.startsWith("image/")) return res.status(400).json({ message: "Only image files are allowed." });
      if (file.size > MAX_ATTACHMENT_SIZE_BYTES) return res.status(400).json({ message: "Each photo must be 5 MB or smaller." });

      const fileName = `ticket-photos/${userId || "guest"}/${safeFileName(file.originalname)}`;
      const { error } = await supabase.storage.from("uploads").upload(fileName, file.buffer, { contentType: file.mimetype, upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("uploads").getPublicUrl(fileName);
      urls.push(data.publicUrl);
    }

    return res.json({ success: true, urls });
  } catch (err) {
    logger.error("upload.ticket_photos_failed", err, { userId: req.user?.id });
    return res.status(500).json({ message: "Upload failed." });
  }
};

const uploadProjectPhoto = async (req, res) => {
  try {
    const files = req.files?.length ? req.files : req.file ? [req.file] : [];
    const userId = String(req.body?.userId || "").trim();
    const projectName = String(req.body?.projectName || "").trim();

    if (!files.length) {
      logger.warn("upload.project_photo_rejected", { adminId: req.adminId, reason: "missing_files", userId, projectName });
      return res.status(400).json({ message: "No files uploaded." });
    }
    if (files.length > MAX_PROJECT_PHOTOS) {
      logger.warn("upload.project_photo_rejected", { adminId: req.adminId, reason: "too_many_files", userId, projectName, count: files.length });
      return res.status(400).json({ message: `You can upload up to ${MAX_PROJECT_PHOTOS} project photos at once.` });
    }
    if (!userId) {
      logger.warn("upload.project_photo_rejected", { adminId: req.adminId, reason: "missing_user_id", projectName });
      return res.status(400).json({ message: "userId is required." });
    }
    if (!projectName) {
      logger.warn("upload.project_photo_rejected", { adminId: req.adminId, reason: "missing_project_name", userId });
      return res.status(400).json({ message: "projectName is required." });
    }
    const userExists = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND is_superadmin = FALSE AND is_admin = FALSE AND is_manager = FALSE LIMIT 1`,
      [userId],
    );

    if (!userExists.rows[0]) {
      logger.warn("upload.project_photo_rejected", { adminId: req.adminId, reason: "customer_not_found", userId, projectName });
      return res.status(404).json({ message: "Customer not found." });
    }

    const folderName = safeFolderName(projectName);
    const uploadedProjects = [];

    for (const file of files) {
      if (!file.mimetype.startsWith("image/")) {
        logger.warn("upload.project_photo_rejected", {
          adminId: req.adminId,
          reason: "invalid_file_type",
          userId,
          projectName,
          mimetype: file.mimetype,
        });
        return res.status(400).json({ message: "Only image files are allowed." });
      }

      if (file.size > MAX_PROJECT_PHOTO_SIZE_BYTES) {
        logger.warn("upload.project_photo_rejected", {
          adminId: req.adminId,
          reason: "file_too_large",
          userId,
          projectName,
          fileName: file.originalname,
          size: file.size,
        });
        return res.status(400).json({ message: "Each project photo must be 5 MB or smaller." });
      }

      const storagePath = `projectphoto/${userId}/${folderName}/${safeFileName(file.originalname)}`;

      const { error } = await supabase.storage
        .from("uploads")
        .upload(storagePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });

      if (error) throw error;

      const { data } = supabase.storage.from("uploads").getPublicUrl(storagePath);

      const inserted = await pool.query(
        `INSERT INTO projects (user_id, project_name, photourl)
         VALUES ($1, $2, $3)
         RETURNING id, user_id, project_name, photourl, created_at, updated_at`,
        [userId, projectName, data.publicUrl],
      );

      uploadedProjects.push({
        ...inserted.rows[0],
        storagePath,
      });
    }

    logger.info("upload.project_photo_completed", {
      adminId: req.adminId,
      userId,
      projectName,
      count: uploadedProjects.length,
    });
    sendNotificationToUser(userId, {
      title: "Project photos added",
      message: `${uploadedProjects.length} new project photo${uploadedProjects.length === 1 ? "" : "s"} uploaded.`,
      type: "project.photo_added",
      projectName,
      count: uploadedProjects.length,
    });

    return res.json({
      success: true,
      count: uploadedProjects.length,
      projects: uploadedProjects,
    });
  } catch (err) {
    logger.error("upload.project_photo_failed", err, { userId: req.body?.userId });
    return res.status(500).json({ message: "Upload failed." });
  }
};

module.exports = {
  upload,
  uploadFile,
  getUseravatarurl,
  uploadUseravatarurl,
  uploadProjectPhoto,
  uploadTicketPhotos,
};
