// controllers/uploadController.js

const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");
const ws = require("ws");
const crypto = require("crypto");
const path = require("path");
const pool = require("../../config/db");
const logger = require("../../util/logger");

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
      return res.status(400).json(error);
    }

    const { data: publicData } = supabase.storage
      .from("uploads")
      .getPublicUrl(`documents/${fileName}`);

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
    return res.status(400).json({
      message: "userId is required.",
    });
  }

  try {
    const { data, error } = await supabase.storage
      .from("uploads")
      .list("avatarurls", {
        search: `${userId}-`,
      });

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      return res.json({
        avatarurl: null,
      });
    }

    const latest = data
      .filter((f) => f.name.startsWith(`${userId}-`))
      .sort((a, b) => {
        const tsA = parseInt(a.name.split("-")[1]) || 0;
        const tsB = parseInt(b.name.split("-")[1]) || 0;

        return tsB - tsA;
      })[0];

    if (!latest) {
      return res.json({
        avatarurl: null,
      });
    }

    const { data: urlData } = supabase.storage
      .from("uploads")
      .getPublicUrl(`avatarurls/${latest.name}`);

    return res.json({
      avatarurl: urlData.publicUrl,
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
    const userId = String(req.body?.userId || "").trim();
    if (!file) {
      return res.status(400).json({ message: "No file uploaded." });
    }
    if (!userId) {
      return res.status(400).json({ message: "userId is required." });
    }

    if (!file.mimetype.startsWith("image/")) {
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

    return res.json({ avatarurl: data.publicUrl });
  } catch (err) {
    logger.error("upload.avatar_failed", err, { userId: req.body?.userId });
    return res.status(500).json({ message: "Upload failed." });
  }
};

const uploadProjectPhoto = async (req, res) => {
  try {
    const files = req.files?.length ? req.files : req.file ? [req.file] : [];
    const userId = String(req.body?.userId || "").trim();
    const projectName = String(req.body?.projectName || "").trim();

    if (!files.length) {
      return res.status(400).json({ message: "No files uploaded." });
    }
    if (!userId) {
      return res.status(400).json({ message: "userId is required." });
    }
    if (!projectName) {
      return res.status(400).json({ message: "projectName is required." });
    }
    const userExists = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND is_admin = FALSE LIMIT 1`,
      [userId],
    );

    if (!userExists.rows[0]) {
      return res.status(404).json({ message: "Customer not found." });
    }

    const folderName = safeFolderName(projectName);
    const uploadedProjects = [];

    for (const file of files) {
      if (!file.mimetype.startsWith("image/")) {
        return res.status(400).json({ message: "Only image files are allowed." });
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
};
