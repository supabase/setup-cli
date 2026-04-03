# `supabase/setup-cli`

The Supabase CLI Action provides an easy way to install the
[Supabase CLI](https://github.com/supabase/cli) on GitHub Actions runners.

The action supports `ubuntu-latest`, `windows-latest`, and `macos-latest`, and
adds the requested `supabase` version to `PATH` for the rest of the job.

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

## Resources

- **Source Code**: <https://github.com/supabase/setup-cli>
- **CLI Documentation**: <https://supabase.com/docs/guides/cli>
