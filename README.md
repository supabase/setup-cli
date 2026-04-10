# :gear: Supabase CLI Action

[![CI](https://github.com/supabase/setup-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/supabase/setup-cli/actions/workflows/ci.yml)
[![E2E](https://github.com/supabase/setup-cli/actions/workflows/e2e.yml/badge.svg)](https://github.com/supabase/setup-cli/actions/workflows/e2e.yml)
[![CodeQL](https://github.com/supabase/setup-cli/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/supabase/setup-cli/actions/workflows/codeql-analysis.yml)

## About

This composite action sets up the Supabase CLI,
[`supabase`](https://github.com/supabase/cli), on GitHub's hosted Actions
runners. Other CI runners like
[Bitbucket](https://bitbucket.org/supabase-cli/setup-cli/src/master/bitbucket-pipelines.yml)
and
[GitLab](https://gitlab.com/sweatybridge/setup-cli/-/blob/main/.gitlab-ci.yml)
are supported via their respective pipelines.

This action can be run on `ubuntu-latest`, `windows-latest`, and `macos-latest`
GitHub Actions runners, and will install and expose a specified version of the
`supabase` CLI on the runner environment.

## Usage

Setup the `supabase` CLI:

```yaml
steps:
  - uses: supabase/setup-cli@v2
```

If `version` is omitted, the action checks the repository root for `bun.lock`,
`pnpm-lock.yaml`, or `package-lock.json` and uses the declared `supabase`
version. If no supported lockfile is present, it falls back to `latest`.

A specific version of the `supabase` CLI can be installed:

```yaml
steps:
  - uses: supabase/setup-cli@v2
    with:
      version: 2.84.2
```

Cache Docker images used by `supabase start` across workflow runs:

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: supabase/setup-cli@v2
    with:
      version: 2.84.2
      cache: true
  - run: supabase start
```

The first run still pulls images from the registry. Later runs can restore the
same image set from the GitHub Actions cache before `supabase start` runs, and
the action saves newly pulled Supabase images at the end of a successful job.

Run `supabase db start` to execute all migrations on a fresh database:

```yaml
steps:
  - uses: supabase/setup-cli@v2
    with:
      version: latest
  - run: supabase init
  - run: supabase db start
```

Since Supabase CLI relies on Docker Engine API, additional setup may be required
on Windows and macOS runners.

## Inputs

The action supports the following inputs:

| Name        | Type    | Description                                            | Default                           | Required |
| ----------- | ------- | ------------------------------------------------------ | --------------------------------- | -------- |
| `version`   | String  | Supabase CLI version (or `latest`)                     | Root lockfile version or `latest` | false    |
| `cache`     | Boolean | Cache Docker images used by Supabase local development | `false`                           | false    |
| `cache-key` | String  | Explicit cache key for Supabase Docker images          | Generated from runner and config  | false    |

The action exposes these outputs:

| Name        | Description                                            |
| ----------- | ------------------------------------------------------ |
| `version`   | Version of installed Supabase CLI                      |
| `cache-hit` | Whether an exact Supabase Docker image cache was found |

## Advanced Usage

Check generated TypeScript types are up-to-date with Postgres schema:

```yaml
steps:
  - uses: supabase/setup-cli@v2
  - run: supabase init
  - run: supabase db start
  - name: Verify generated types match Postgres schema
    run: |
      supabase gen types typescript --local > schema.gen.ts
      if ! git diff --ignore-space-at-eol --exit-code --quiet schema.gen.ts; then
        echo "Detected uncommitted changes after build. See status below:"
        git diff
        exit 1
      fi
```

Release job to push schema changes to a Supabase project:

```yaml
env:
  SUPABASE_ACCESS_TOKEN: ${{ secrets.ACCESS_TOKEN }}
  SUPABASE_DB_PASSWORD: ${{ secrets.DB_PASSWORD }}
  # Retrieve <project-id> from dashboard url: https://app.supabase.com/project/<project-id>
  PROJECT_ID: <project-id>

steps:
  - uses: supabase/setup-cli@v2
  - run: supabase link --project-ref $PROJECT_ID
  - run: supabase db push
```

Export local Supabase env vars for app tests:

```yaml
steps:
  - uses: supabase/setup-cli@v2
    with:
      cache: true
  - run: supabase init
  - run: supabase start
  - name: Export local Supabase env vars
    run: |
      # Customize the variable names as needed for your app.
      supabase status -o env \
        --override-name api.url=SUPABASE_URL \
        --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY \
        >> .env.test
  - run: bun test
```

Customize the Docker image cache key when the image set depends on your workflow
flags, generated config, or monorepo layout:

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: supabase/setup-cli@v2
    with:
      cache: true
      cache-key: supabase-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('supabase/config.toml') }}-start-all
  - run: supabase start
```

Avoid running `docker system prune -a` before the job ends if you want the
post-action cache save to include images pulled by `supabase start`.

## Develop

After you've cloned the repository to your local machine or codespace, you'll
need to perform a few setup steps before you can work on the action.

> [!NOTE]
>
> You'll need a recent version of [Bun](https://bun.sh) for local development.
> This repository includes a `.bun-version` file for tools that can auto-switch
> Bun versions.

1. :hammer_and_wrench: Install the dependencies

   ```bash
   bun install
   ```

1. :white_check_mark: Run the tests

   ```bash
   bun test
   ```

1. :package: Build the bundled action entrypoints

   ```bash
   bun run build
   ```

1. :mag: Run the full local CI suite

   ```bash
   bun run ci
   ```

## Publish

1. Create a new GitHub release
2. Rebase `v2` branch on `main`

Your action is now published! :rocket:

See the
[versioning documentation](https://github.com/actions/toolkit/blob/master/docs/action-versioning.md)

## Validate

Validate changes by exercising the action from a workflow in this repository
(see [ci.yml](.github/workflows/ci.yml) and [e2e.yml](.github/workflows/e2e.yml)).

```yaml
steps:
  - uses: ./
    with:
      version: latest
```

The CI workflow provides fast smoke coverage across GitHub-hosted runners, and
the E2E workflow verifies `supabase init` and `supabase start` against supported
Postgres versions. See the [actions tab](https://github.com/supabase/setup-cli/actions)
for recent runs.
