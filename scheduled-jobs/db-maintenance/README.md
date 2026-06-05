# DB Maintenance

Runs scheduled cleanup for time-based backend data.

The script:

- Deletes expired `pending_registrations`.
- Deletes expired `pending_email_changes`.
- Deletes expired or used `password_reset_tokens`.
- Deletes sessions inactive for 30 days.

## Run Manually

```bat
npm run maintenance:db
```

Logs are printed directly in the terminal.

## Dry Run

Preview affected row counts without changing data:

```bat
set DB_MAINTENANCE_DRY_RUN=true
npm run maintenance:db
```

## Optional Settings

- `DB_MAINTENANCE_DRY_RUN`: set to `true` to skip changes

## Daily Run

The backend starts the daily scheduler automatically from `src/services/dailyJobScheduler.js`.
Set `DAILY_JOBS_TASK_TIME` in `.env.local`, then restart the server.
