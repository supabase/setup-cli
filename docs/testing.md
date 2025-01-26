# Automated testing

You can use the Supabase CLI to run automated tests. 

## Testing your database

After you have [created unit tests](https://supabase.com/docs/guides/database/testing) for your database, you can use the GitHub Action to run the tests.

Inside your repository, create a new file inside the `.github/workflows` folder called `database-tests.yml`. Copy this snippet inside the file, and the action will run whenever a new PR is created:

```yaml
name: 'database-tests'
on:
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - run: supabase db start
      - run: supabase test db

```

## Testing your Edge Functions

After you have [created unit tests](https://supabase.com/docs/guides/functions/unit-test) for your Edge Functions, you can use the GitHub Action to run the tests.

Inside your repository, create a new file inside the `.github/workflows` folder called `functions-tests.yml`. Copy this snippet inside the file, and the action will run whenever a new PR is created:

```yaml
name: 'functions-tests'
on:
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - uses: denoland/setup-deno@v2
        with:
          deno-version: latest
      - run: supabase start
      - run: deno test --allow-all deno-test.ts --env-file .env.local

```

## More resources

- Learn more about the [pgTAP extension](https://supabase.com/docs/guides/database/extensions/pgtap) for database testing.
- Official pgTAP Documentation: [pgtap.org](https://pgtap.org/)
