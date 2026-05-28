# Avatar URL Cleanup

Runs a daily-safe cleanup for Supabase avatar files.

The script:

- Reads all `avatarurl` values from `users` and `pending_registrations`.
- Lists files in Supabase Storage bucket `uploads`, folder `avatarurls`.
- Deletes files from `avatarurls` that are not referenced by the database and are older than the configured grace period.

This also cleans older profile photos after a user changes their avatar. Once the new `avatarurl` is saved in the database, the previous Supabase avatar file is no longer referenced and will be deleted on the next cleanup run after the grace period.

## Run Manually

```bat
npm run cleanup:avatars
```

Logs are printed directly in the terminal.

## Dry Run

Preview stale files without deleting:

```bat
set AVATAR_CLEANUP_DRY_RUN=true
npm run cleanup:avatars
```

## Optional Settings

- `AVATAR_CLEANUP_BUCKET`: defaults to `uploads`
- `AVATAR_CLEANUP_FOLDER`: defaults to `avatarurls`
- `AVATAR_CLEANUP_DRY_RUN`: set to `true` to skip deletion
- `AVATAR_CLEANUP_PAGE_SIZE`: defaults to `100`
- `AVATAR_CLEANUP_MIN_AGE_HOURS`: defaults to `24`

## Daily Run

The backend starts the daily scheduler automatically from `src/services/dailyJobScheduler.js`.
Set `DAILY_JOBS_TASK_TIME` in `.env.local`, then restart the server.
