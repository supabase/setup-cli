# Backup your database

You can use the Supabase CLI to backup your Postgres database. The steps involve running a series of commands to dump roles, schema, and data separately.
Inside your repository, create a new file inside the `.github/workflows` folder called `backup.yml`. Copy the following snippet inside the file, and the action will run whenever a new PR is created:

## Backup action

```yaml
name: 'backup-database'
on:
  pull_request:
jobs:
  build: 
    runs-on: ubuntu-latest
    env:
      supabase_db_url: ${{ secrets.SUPABASE_DB_URL }}   # For example: postgresql://postgres:[YOUR-PASSWORD]@db.<ref>.supabase.co:5432/postgres
    steps:
      - uses: actions/checkout@v2
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - name: Backup roles
        run: supabase db dump --db-url "$supabase_db_url" -f roles.sql --role-only
      - name: Backup schema
        run: supabase db dump --db-url "$supabase_db_url" -f schema.sql
      - name: Backup data
        run: supabase db dump --db-url "$supabase_db_url" -f data.sql --data-only --use-copy
```
## Periodic Backups Workflow

This section describes a workflow that creates periodic backups of your Supabase database. The workflow is triggered by `push` and `pull_request` events on the `main` branch, manually via `workflow_dispatch`, and automatically at midnight every day due to the `schedule` event with a `cron` expression.
The workflow runs on the latest Ubuntu runner and requires write permissions to the repository's contents. It uses the Supabase CLI to dump the roles, schema, and data from your Supabase database, utilizing the `SUPABASE_DB_URL` environment variable that is securely stored in the GitHub secrets.
After the backup is complete, it auto-commits the changes to the repository using the `git-auto-commit-action`. This ensures that the latest backup is always available in your repository. The commit message for these automated commits is "Supabase backup".
This workflow provides an automated solution for maintaining regular backups of your Supabase database. It helps keep your data safe and enables easy restoration in case of any accidental data loss or corruption.

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
      supabase_db_url: ${{ secrets.SUPABASE_DB_URL }}   # For example: postgresql://postgres:[YOUR-PASSWORD]@db.<ref>.supabase.co:5432/postgres
    steps:
      - uses: actions/checkout@v3
        with:
          ref: ${{ github.head_ref }}
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - name: Backup roles
        run: supabase db dump --db-url "$supabase_db_url" -f roles.sql --role-only
      - name: Backup schema
        run: supabase db dump --db-url "$supabase_db_url" -f schema.sql
      - name: Backup data
        run: supabase db dump --db-url "$supabase_db_url" -f data.sql --data-only --use-copy

      - uses: stefanzweifel/git-auto-commit-action@v4
        with:
          commit_message: Supabase backup
```

## More resources

- Backing up and migrating your project: [Migrating and Upgrading](https://supabase.com/docs/guides/platform/migrating-and-upgrading-projects)
