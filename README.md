# :gear: Supabase CLI Action

[![CI](https://github.com/supabase/setup-cli/actions/workflows/start.yml/badge.svg)](https://github.com/supabase/setup-cli/actions/workflows/start.yml)
[![Linter](https://github.com/supabase/setup-cli/actions/workflows/linter.yml/badge.svg)](https://github.com/supabase/setup-cli/actions/workflows/linter.yml)
[![CodeQL](https://github.com/supabase/setup-cli/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/supabase/setup-cli/actions/workflows/codeql-analysis.yml)
[![Coverage](./badges/coverage.svg)](https://github.com/supabase/setup-cli/actions/workflows/test.yml)

## About

This action sets up the Supabase CLI,
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
  - uses: supabase/setup-cli@v1
```

A specific version of the `supabase` CLI can be installed:

```yaml
steps:
  - uses: supabase/setup-cli@v1
    with:
      version: 2.20.3
```

Run `supabase db start` to execute all migrations on a fresh database:

```yaml
steps:
  - uses: supabase/setup-cli@v1
    with:
      version: latest
  - run: supabase init
  - run: supabase db start
```

Since Supabase CLI relies on Docker Engine API, additional setup may be required
on Windows and macOS runners.

## Inputs

The actions supports the following inputs:

| Name      | Type   | Description                        | Default  | Required |
| --------- | ------ | ---------------------------------- | -------- | -------- |
| `version` | String | Supabase CLI version (or `latest`) | `2.20.3` | false    |

## Advanced Usage

Check generated TypeScript types are up-to-date with Postgres schema:

```yaml
steps:
  - uses: supabase/setup-cli@v1
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
   - uses: supabase/setup-cli@v1
   - run: supabase link --project-ref $PROJECT_ID
   - run: supabase db push
```

## Develop

After you've cloned the repository to your local machine or codespace, you'll
need to perform some initial setup steps before you can develop your action.

> [!NOTE]
>
> You'll need to have a reasonably modern version of
> [Node.js](https://nodejs.org) handy (20.x or later should work!). If you are
> using a version manager like [`nodenv`](https://github.com/nodenv/nodenv) or
> [`fnm`](https://github.com/Schniz/fnm), this template has a `.node-version`
> file at the root of the repository that can be used to automatically switch to
> the correct version when you `cd` into the repository. Additionally, this
> `.node-version` file is used by GitHub Actions in any `actions/setup-node`
> actions.

1. :hammer_and_wrench: Install the dependencies

   ```bash
   npm ci
   ```

1. :building_construction: Package the TypeScript for distribution

   ```bash
   npm run bundle
   ```

1. :white_check_mark: Run the tests

   ```bash
   $ npm test

   PASS  ./index.test.js
     ✓ gets download url to binary (3 ms)
     ✓ runs main action (891 ms)

   ...
   ```

## Publish to a distribution branch

Actions are run from this GitHub repository so we will checkin the packed `dist`
folder.

1. Create a new GitHub release
2. Rebase `v1` branch on `main`

Your action is now published! :rocket:

See the
[versioning documentation](https://github.com/actions/toolkit/blob/master/docs/action-versioning.md)

## Validate

You can now validate the action by referencing `./` in a workflow in your
repository (see [test.yml](.github/workflows/test.yml))

```yaml
uses: ./
with:
  version: latest
```

See the [actions tab](https://github.com/supabase/setup-cli/actions) for runs of
this action! :rocket:
