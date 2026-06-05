const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const ws = require("ws");

require(path.resolve(__dirname, "../../src/config/env"));

const pool = require("../../src/config/db");
const logger = require("../../src/util/logger");
const { recordBatchJob } = require("../../src/util/batchJobRuns");

const bucket = process.env.AVATAR_CLEANUP_BUCKET || "uploads";
const folder = normalizeFolder(process.env.AVATAR_CLEANUP_FOLDER || "avatarurls");
const dryRun = String(process.env.AVATAR_CLEANUP_DRY_RUN || "").toLowerCase() === "true";
const pageSize = Number(process.env.AVATAR_CLEANUP_PAGE_SIZE || 100);
const minAgeHours = Number(process.env.AVATAR_CLEANUP_MIN_AGE_HOURS || 24);

function normalizeFolder(value) {
  return String(value || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
}

function normalizeStoragePath(value) {
  return String(value || "")
    .trim()
    .replace(/^\/+/, "");
}

function avatarUrlToStoragePath(value) {
  const avatarUrl = String(value || "").trim();
  if (!avatarUrl) return null;

  try {
    const parsed = new URL(avatarUrl);
    const marker = `/storage/v1/object/public/${bucket}/`;
    const markerIndex = parsed.pathname.indexOf(marker);

    if (markerIndex !== -1) {
      return normalizeStoragePath(
        decodeURIComponent(parsed.pathname.slice(markerIndex + marker.length)),
      );
    }
  } catch (_err) {
    // Values may already be storage paths instead of full public URLs.
  }

  const normalized = normalizeStoragePath(avatarUrl);
  if (normalized.startsWith(`${bucket}/`)) {
    return normalized.slice(bucket.length + 1);
  }

  return normalized;
}

async function getReferencedAvatarPaths() {
  const { rows } = await pool.query(
    `
      SELECT avatarurl FROM users
      WHERE avatarurl IS NOT NULL AND TRIM(avatarurl) <> ''
      UNION
      SELECT avatarurl FROM pending_registrations
      WHERE avatarurl IS NOT NULL AND TRIM(avatarurl) <> ''
    `,
  );

  return new Set(
    rows
      .map((row) => avatarUrlToStoragePath(row.avatarurl))
      .filter((storagePath) => storagePath && storagePath.startsWith(`${folder}/`)),
  );
}

async function listAvatarFiles(supabase) {
  const files = [];
  let offset = 0;
  const minCreatedAt = new Date(Date.now() - minAgeHours * 60 * 60 * 1000);

  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list(folder, {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" },
    });

    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const item of data) {
      if (item.name) {
        files.push({
          storagePath: `${folder}/${item.name}`,
          createdAt: item.created_at || null,
          isOldEnough:
            !item.created_at || new Date(item.created_at).getTime() <= minCreatedAt.getTime(),
        });
      }
    }

    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return files;
}

async function main(options = {}) {
  const closePool = options.closePool !== false;
  const runSource = options.runSource || "manual";

  console.log("Avatar cleanup: started");
  console.log(`Avatar cleanup: bucket=${bucket}, folder=${folder}, dryRun=${dryRun}`);

  try {
    return await recordBatchJob({
      jobName: "avatar_cleanup",
      runSource,
      dryRun,
      metadata: {
        bucket,
        folder,
        minAgeHours,
      },
    }, async () => {
      if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
        throw new Error("SUPABASE_URL and SUPABASE_KEY are required.");
      }

      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
        realtime: {
          transport: ws,
        },
      });
      const referencedPaths = await getReferencedAvatarPaths();
      const storedFiles = await listAvatarFiles(supabase);
      const staleFiles = storedFiles.filter(
        (file) => file.isOldEnough && !referencedPaths.has(file.storagePath),
      );
      const stalePaths = staleFiles.map((file) => file.storagePath);
      const skippedRecentCount = storedFiles.filter((file) => !file.isOldEnough).length;
      const summary = {
        bucket,
        folder,
        minAgeHours,
        referencedCount: referencedPaths.size,
        storedCount: storedFiles.length,
        staleCount: stalePaths.length,
        skippedRecentCount,
        deletedCount: 0,
      };

      console.log(
        `Avatar cleanup: referenced=${referencedPaths.size}, stored=${storedFiles.length}, stale=${stalePaths.length}, skippedRecent=${skippedRecentCount}`,
      );

      logger.info("avatar_cleanup.scanned", {
        bucket,
        folder,
        minAgeHours,
        referencedCount: referencedPaths.size,
        storedCount: storedFiles.length,
        staleCount: stalePaths.length,
        skippedRecentCount,
        dryRun,
      });

      if (stalePaths.length === 0 || dryRun) {
        if (dryRun && stalePaths.length > 0) {
          logger.info("avatar_cleanup.dry_run_stale_files", { files: stalePaths });
        }

        console.log(
          dryRun
            ? "Avatar cleanup: dry run complete, no files deleted"
            : "Avatar cleanup: complete, no stale files to delete",
        );
        return {
          status: "success",
          metadata: summary,
        };
      }

      const { data, error } = await supabase.storage.from(bucket).remove(stalePaths);
      if (error) throw error;
      const deletedCount = data?.length || stalePaths.length;
      summary.deletedCount = deletedCount;

      logger.info("avatar_cleanup.deleted", {
        deletedCount,
        files: stalePaths,
      });
      console.log(`Avatar cleanup: deleted ${deletedCount} files`);
      return {
        status: "success",
        metadata: summary,
      };
    });
  } finally {
    if (closePool) {
      await pool.end();
    }
  }
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error(`Avatar cleanup: failed - ${err?.message || err}`);
      logger.error("avatar_cleanup.failed", err);
      process.exitCode = 1;
    });
}

module.exports = { main };
