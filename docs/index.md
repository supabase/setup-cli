# `supabase/setup-cli`

The Supabase CLI Action provides an easy way to install the
[Supabase CLI](https://github.com/supabase/cli) on GitHub Actions runners.

The action supports `ubuntu-latest`, `windows-latest`, and `macos-latest`, and
adds the requested `supabase` version to `PATH` for the rest of the job.

If `version` is omitted, the action checks the repository root for `bun.lock`,
`pnpm-lock.yaml`, or `package-lock.json` and otherwise falls back to `latest`.

## Quick Start

This example runs Supabase migrations on every pull request:

```yaml
name: test-migrations

on:
  pull_request:

jobs:
  test-migrations:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: supabase/setup-cli@v2
      - run: supabase init
      - run: supabase db start
```

To pin a specific CLI version:

```yaml
- uses: supabase/setup-cli@v2
  with:
    version: 2.84.2
```

To cache the Docker images pulled by `supabase start`:

```yaml
- uses: supabase/setup-cli@v2
  with:
    version: 2.84.2
    cache: true
- run: supabase start
```

The first run pulls the images from the registry. Later runs can restore the
same image archive from the GitHub Actions cache before `supabase start` runs.
Use `cache-key` when your workflow flags or generated config change the image
set.

## Resources

- **Source Code**: <https://github.com/supabase/setup-cli>
- **CLI Documentation**: <https://supabase.com/docs/guides/cli>
