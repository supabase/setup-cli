# :gear: Supabase CLI Action

![](https://github.com/supabase/setup-cli/workflows/build-test/badge.svg)
![](https://github.com/supabase/setup-cli/workflows/CodeQL/badge.svg)

## About

This action sets up the Supabase CLI, [`supabase`](https://github.com/supabase/cli), on GitHub's hosted Actions runners.

This action can be run on `ubuntu-latest`, `windows-latest`, and `macos-latest` GitHub Actions runners, and will install and expose a specified version of the `supabase` CLI on the runner environment.

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
      version: 0.34.2
```

Run `supabase start` to execute all migrations on a fresh database:

```yaml
steps:
  - uses: supabase/setup-cli@v1
    with:
      version: 0.34.2
  - run: supabase init
  - run: supabase start
```

Since Supabase CLI relies on Docker Engine API, additional setup may be required on Windows and macOS runners.

## Inputs

The actions supports the following inputs:

- `version`: The version of `supabase` to install, defaulting to `0.34.2`

## Advanced Usage

Check generated TypeScript types are up-to-date with Postgres schema:

```yaml
- name: Verify generated types are checked in
  run: |
    supabase gen types typescript --local > schema.gen.ts
    if [ "$(git diff --ignore-space-at-eol schema.gen.ts | wc -l)" -gt "0" ]; then
      echo "Detected uncommitted changes after build. See status below:"
      git diff
      exit 1
    fi
```

## Develop

> Requires `node >= 16`

Install the dependencies

```bash
$ npm install
```

Build the typescript and package it for distribution

```bash
$ npm run build && npm run package
```

Run the tests :heavy_check_mark:

```bash
$ npm test

 PASS  __tests__/main.test.ts
  ✓ gets download url to binary (3 ms)
  ✓ test runs (891 ms)

...
```

## Publish to a distribution branch

Actions are run from GitHub repos so we will checkin the packed dist folder.

Then run [ncc](https://github.com/zeit/ncc) and push the results:

```bash
$ npm run package
$ git add dist
$ git commit -a -m "Update dependencies"
$ git push origin releases/v1
```

Note: We recommend using the `--license` option for ncc, which will create a license file for all of the production node modules used in your project.

Your action is now published! :rocket:

See the [versioning documentation](https://github.com/actions/toolkit/blob/master/docs/action-versioning.md)

## Validate

You can now validate the action by referencing `./` in a workflow in your repo (see [test.yml](.github/workflows/test.yml))

```yaml
uses: ./
with:
  version: 0.34.2
```

See the [actions tab](https://github.com/actions/typescript-action/actions) for runs of this action! :rocket:
