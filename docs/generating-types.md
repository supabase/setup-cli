# Generating Types

You can use the Supabase CLI to automatically generate Typescript definitions from your Postgres database. You can then pass these definitions to your `supabase-js` client and get end-to-end type safety across client, server, and database.

Inside your repository, create a new file inside the `.github/workflows` folder called `generate-types.yml`. Copy this snippet inside the file, and the action will run whenever a new PR is created:

## Verify types

```yaml
name: 'generate-types'
on:
  pull_request:

jobs:
  build: 
    runs-on: ubuntu-latest
    steps:
        - uses: supabase/setup-cli@v1
          with:
            version: latest
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


## More resources

- Using supabase-js with type definitions: [Typescript Support](https://supabase.com/docs/reference/javascript/typescript-support)
