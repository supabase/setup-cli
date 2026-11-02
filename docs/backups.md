# Backup your database

You can use the Supabase CLI to backup your Postgres database. The steps involve running a series of commands to dump roles, schema, and data separately.
Inside your repository, create a new file inside the `.github/workflows` folder called `backup.yml`. Copy the following snippet inside the file, and the action will run whenever a new PR is created.

!!! note

    Never backup your data to a public repository. 

!!! note

    GitHub-hosted runners only support IPv4, and the direct connection string (`db.<ref>.supabase.co`) is IPv6 unless your project has the [IPv4 add-on](https://supabase.com/docs/guides/platform/ipv4-address). Store the **Session pooler** connection string from the [Connect panel](https://supabase.com/dashboard/project/_?showConnect=true&method=session) as the `SUPABASE_DB_URL` secret instead.

## Backup action

```yaml
name: 'backup-database'
on:
  pull_request:
jobs:
  build: 
    runs-on: ubuntu-latest
    env:
      supabase_db_url: ${{ secrets.SUPABASE_DB_URL }}   # For example: postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres
    steps:
      - uses: actions/checkout@v5
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - name: Backup roles
        run: supabase db dump --remote="$supabase_db_url" -f roles.sql --role-only
      - name: Backup schema
        run: supabase db dump --remote="$supabase_db_url" -f schema.sql
      - name: Backup data
        run: supabase db dump --remote="$supabase_db_url" -f data.sql --data-only --use-copy -x "storage.buckets_vectors" -x "storage.vector_indexes"
```
## Periodic Backups Workflow

You can use the GitHub Action to run periodic backups of your database. In this example, the Action workflow is triggered by `push` and `pull_request` events on the `main` branch, manually via `workflow_dispatch`, and automatically at midnight every day due to the `schedule` event with a `cron` expression.
The workflow runs on the latest Ubuntu runner and requires write permissions to the repository's contents. It uses the Supabase CLI to dump the roles, schema, and data from your Supabase database, utilizing the `SUPABASE_DB_URL` environment variable that is securely stored in the GitHub secrets.
After the backup is complete, it auto-commits the changes to the repository using the `git-auto-commit-action`. The commit message for these automated commits is "Supabase backup".

!!! warning

    `data.sql` holds the rows from your tables as plain-text SQL, including email addresses and password hashes from `auth.users`. Anyone with read access to the repository can read it, and every committed dump stays in the Git history even after you delete the file. Never backup your data to a public repository. For anything beyond a small private project, consider uploading the files to a private storage bucket instead of committing them.

```yaml
name: Supa-backup

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]
  workflow_dispatch:
  schedule:
    - cron: '0 0 * * *' # Runs every day at midnight
jobs:   
  run_db_backup:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    env:
      supabase_db_url: ${{ secrets.SUPABASE_DB_URL }}   # For example: postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres
    steps:
      - uses: actions/checkout@v5
        with:
          ref: ${{ github.head_ref }}
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - name: Backup roles
        run: supabase db dump --remote="$supabase_db_url" -f roles.sql --role-only
      - name: Backup schema
        run: supabase db dump --remote="$supabase_db_url" -f schema.sql
      - name: Backup data
        run: supabase db dump --remote="$supabase_db_url" -f data.sql --data-only --use-copy -x "storage.buckets_vectors" -x "storage.vector_indexes"

      - uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: Supabase backup
```

## Check that the backup restores

A dump that finishes without errors can still fail to restore. For example, a data dump that includes `storage.buckets_vectors` fails with `permission denied for table buckets_vectors` when you load it, which is why the commands above exclude that table and `storage.vector_indexes`.

To catch problems like this when the backup runs, add a step at the end of the job that loads the three files into a throwaway local database on the runner. It starts Postgres with `supabase db start` in a temporary directory and runs the restore command from [Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore). With `--single-transaction` and `ON_ERROR_STOP`, any error fails the step.

```yaml
      - name: Check that the backup restores
        run: |
          supabase init --workdir "$RUNNER_TEMP/restore-check"
          supabase db start --workdir "$RUNNER_TEMP/restore-check"
          psql \
            --single-transaction \
            --variable ON_ERROR_STOP=1 \
            --file roles.sql \
            --file schema.sql \
            --command 'SET session_replication_role = replica' \
            --file data.sql \
            --dbname 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
```

## More resources

- Backing up and restoring your project: [Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- Daily backups and Point-in-Time Recovery: [Database Backups](https://supabase.com/docs/guides/platform/backups)
