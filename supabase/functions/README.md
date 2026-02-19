# Supabase Edge Functions (Rollback Archive Only)

Active runtime is VM-hosted:

- `/functions/v1/<function-name>` on your Hetzner API

Supabase remains:

- Auth (`/auth/v1/*`)
- Postgres database

This directory is kept only as rollback/archive source and should not be deployed in normal operations.

If rollback is required, deploy explicitly and revert client runtime routing afterward.
