# `supabase-github-action`

The Supabase GitHub Action provides an easy way to use the Supabase CLI on GitHub's hosted Actions runners.

The action can be run on `ubuntu-latest`, `windows-latest`, and `macos-latest` GitHub Actions runners, and will install and expose a specified version of the Supabase CLI on the runner environment.

## Quick start

This example shows how you can use the Supabase GitHub Action to test your migrations on every Pull Request.

Inside your repository, create a new file inside the `.github/workflows` folder called `test-migrations.yml`.

Copy this snippet inside the file, and the action will run whenever a new PR is created:

```yaml
name: 'test-migrations'
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
```


## Resources

- **Source Code**: <a href="https://github.com/supabase/supabase-github-action" target="_blank">github.com/supabase/supabase-github-action</a>
- **CLI Documentation**: <a href="https://supabase.com/docs/guides/cli" target="_blank">supabase.com/docs/guides/cli</a>
