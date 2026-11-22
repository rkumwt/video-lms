# @vlp/db

Prisma 7 schema, migrations and a typed client for PostgreSQL. Used by `apps/api` (and `apps/worker` from Phase 9).

- **Client:** `createDb()` returns a `PrismaClient` using the `@prisma/adapter-pg` driver adapter
  (node-postgres, no Rust query engine).
- **Generated code:** `src/generated/prisma` is git-ignored. `pnpm build` runs `prisma generate`, and
  Turbo runs it before lint, typecheck and test.
- **Contracts:** API/browser types live in `@vlp/shared`. `src/enums.test.ts` fails CI if the Zod
  enums and Prisma enums drift apart.

## Models

| Model     | Notes                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Video`   | UUIDv7 ids (time-ordered, index-friendly), `sizeBytes` is `BIGINT` (files > 2 GB), indexes on `createdAt DESC` (home list) and `status` (worker). |
| `Setting` | Singleton row (`id = 1`), enforced by a `CHECK` constraint and seeded by the first migration.                                                     |

**Stage 2 (courses, topics, tags, AI)** adds new tables and nullable foreign keys or join tables pointing
at `videos`. These are purely additive migrations, so no existing columns change.

## Local workflow

```bash
pnpm docker:deps                              # Postgres in Docker
cp packages/db/.env.example packages/db/.env  # DATABASE_URL
pnpm db:migrate --name add_something          # create + apply a migration (prisma migrate dev)
pnpm db:studio                                # browse data
```

Rules for migrations, so deploys stay zero-downtime:

1. **Backward compatible.** The previous app version must still work after the migration runs:
   add nullable columns, add tables, add indexes.
2. Use **expand → contract** for renames and removals: add the new column → deploy code that writes
   both → backfill → deploy code that reads the new column → drop the old one in a later PR.
3. Never edit a migration that has been merged. Add a new one instead.

## How migrations run on AWS

The deploy workflow runs `cdk deploy … Vlp-Data Vlp-Migrate`, then `scripts/deploy/run-migrations.sh`,
which starts a one-off Fargate task that runs `prisma migrate deploy` from the new API image. Only after
it exits with code 0 does it run `cdk deploy Vlp-App` to roll out the services. Database credentials
come from Secrets Manager as `DB_*` variables, and TLS is verified against the RDS CA bundle baked into
the image.
