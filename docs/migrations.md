# Managing database migrations

Migrations are programmatic changes to your database. They are usually checked into Git.

## Testing your migrations

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
