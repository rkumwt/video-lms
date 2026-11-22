# Learning Video Platform

Record your screen (optionally with camera + mic), save it to local disk or S3, and browse your library.

> **Status:** Phase 5: PostgreSQL (Prisma + RDS), with migrations run by the deploy pipeline.

## Repository layout

```
apps/
  web/       React + Vite + Tailwind + shadcn/ui (SPA, served by CloudFront on AWS)
  api/       Express 5 REST API (ECS Fargate behind an ALB)
  worker/    Background processor (ECS Fargate, consumes SQS in Phase 9)
packages/
  config/    Shared ESLint flat configs + tsconfig bases
  shared/    Zod schemas + inferred types shared by web, api and worker
  db/        Prisma schema, migrations, typed client (see packages/db/README.md)
infra/       AWS CDK app (Network, Foundation, App stacks)
scripts/     Deploy helpers (push images, deploy web)
docs/        Engineering guides (git workflow, CI/CD, ADRs)
```

## Tech decisions (short)

| Decision                                             | Why                                                                                                        |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **pnpm workspaces + Turborepo**                      | Strict, fast installs; Turbo caches `lint/typecheck/test/build` per package locally and in CI.             |
| **Node 24 LTS, ESM everywhere**                      | Current Active LTS; one module system across apps.                                                         |
| **TypeScript 6.0 (not 7)**                           | typescript-eslint does not support TS 7 yet. Upgrade when it does.                                         |
| **`@vlp/shared` = compiled package (tsup)**          | API/worker run plain `node dist/…` in Docker, so shared code must be JS. Apps depend on `^build` in Turbo. |
| **API bundled with tsup**                            | Fast builds, no `.js` import suffixes; npm deps stay external and are installed in the image.              |
| **Zod for env + request validation + API contracts** | One schema → runtime validation and TS types on both sides. Bad env = crash at boot (fail fast).           |
| **Same-origin `/api`**                               | Vite proxies `/api` locally; CloudFront routes `/api/*` to the ALB on AWS → no CORS, no mixed-content.     |
| **`/health` and `/api/health`**                      | `/health` for the ALB target group, `/api/health` reachable from the browser via CloudFront.               |
| **pino JSON logs**                                   | Structured logs are queryable in CloudWatch Logs Insights; pretty-printed only in development.             |

## Prerequisites

- Node **24** (`nvm install 24 && nvm use` — the repo has `.nvmrc`)
- pnpm **9** (`corepack enable` or `npm i -g pnpm@9`)
- Docker Desktop (≥ 4 GB memory)

## Getting started

```bash
nvm use
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/worker/.env.example apps/worker/.env
cp apps/web/.env.example apps/web/.env
cp packages/db/.env.example packages/db/.env
pnpm docker:deps          # Postgres
pnpm db:deploy            # apply migrations
pnpm dev
```

- Web: http://localhost:5173 (shows live API status)
- API: http://localhost:4000/health (liveness), http://localhost:4000/health/ready (DB check)

## Scripts (run from the repo root)

| Command                                      | What it does                                                 |
| -------------------------------------------- | ------------------------------------------------------------ |
| `pnpm dev`                                   | Runs web, api, worker in watch mode (shared is built first). |
| `pnpm build`                                 | Builds every package (Turbo-cached).                         |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Quality gates, per package.                                  |
| `pnpm check`                                 | All of the above — the same thing CI runs on a PR.           |
| `pnpm format`                                | Prettier write.                                              |
| `pnpm --filter @vlp/api dev`                 | Run a single app.                                            |

## Quality gates

- **ESLint** (flat config, type-aware via `typescript-eslint`) + **Prettier** (with Tailwind class sorting).
- **Husky**: `pre-commit` runs lint-staged (Prettier on staged files); `commit-msg` runs **commitlint**.
- **Conventional Commits** with scopes: `web, api, worker, shared, config, db, infra, ci, deps, docker, repo`.
  e.g. `feat(api): add presigned upload endpoint`, `chore(infra): add CDK stack`.

## Adding a shadcn/ui component

```bash
cd apps/web && pnpm dlx shadcn@latest add card
```

Check the generated import is `@/lib/utils` (the CLI sometimes writes `"cn"`).

## Docker

Each deployable app has its own multi-stage `Dockerfile`; the build context is always the repo root.

| Image                    | Stages                           | Runtime                              | Used on AWS                              |
| ------------------------ | -------------------------------- | ------------------------------------ | ---------------------------------------- |
| `apps/api/Dockerfile`    | base → pruner → builder → runner | `node:24-slim`, non-root `node` user | ECS Fargate                              |
| `apps/worker/Dockerfile` | same                             | same                                 | ECS Fargate                              |
| `apps/web/Dockerfile`    | … → `nginx-unprivileged`         | static files + `/api` proxy          | No (S3 + CloudFront) — local parity only |

How the build stays fast and small:

1. **`turbo prune <app> --docker`** copies only the workspace packages the app depends on, split into
   `out/json` (manifests + lockfile) and `out/full` (sources).
2. `pnpm install --frozen-lockfile` runs on manifests only, so that layer is cached until dependencies
   change. The pnpm store is a BuildKit cache mount.
3. `pnpm deploy --prod` produces a self-contained folder (prod `node_modules` + `dist`), copied into
   a clean runtime stage. No compilers, sources or dev dependencies ship.
4. `APP_VERSION` build arg (CI passes the git SHA) is exposed by `/health`.

**Why `node:24-slim` and not Alpine:** Vite 8's native bundler (rolldown) crashes with a bus error on
Alpine/musl arm64, and Prisma (Phase 5) also prefers glibc. Builder and runtime use the same base so
native modules always match. Images are built for **arm64**, which matches Apple Silicon and the
cheaper Graviton Fargate tasks we'll use in Phase 3.

### Compose stack

```bash
cp .env.example .env          # local-only credentials, git-ignored
pnpm docker:deps              # Postgres only -> run apps on the host with `pnpm dev`
pnpm docker:up                # Postgres + api + worker + web (built from Dockerfiles)
pnpm docker:logs
pnpm docker:down              # keeps the pgdata volume; add `-v` to wipe it
```

| Service               | URL                                | Profile |
| --------------------- | ---------------------------------- | ------- |
| web (nginx)           | http://localhost:8080              | `app`   |
| api                   | http://localhost:4000/health       | `app`   |
| worker                | — (logs only)                      | `app`   |
| postgres              | `localhost:${POSTGRES_PORT:-5432}` | default |
| localstack (S3 + SQS) | http://localhost:4566              | `aws`   |

LocalStack is optional: `docker compose --profile aws up -d localstack`. Its init script
(`docker/localstack/init-aws.sh`) creates the `vlp-videos-local` bucket (with CORS) and the
`vlp-video-events` queue + DLQ (maxReceiveCount 5), mirroring what CDK will create on AWS.
If a newer LocalStack image asks for a token, set `LOCALSTACK_AUTH_TOKEN` in `.env`.

Build a single image manually:

```bash
docker build -f apps/api/Dockerfile --build-arg APP_VERSION=$(git rev-parse --short HEAD) -t vlp-api .
```

## Environment variables

Every app ships a `.env.example`. Real `.env` files are git-ignored. On AWS, values come from
ECS task definitions and **Secrets Manager** (Phase 3+). Only `VITE_*` vars reach the browser — never
put secrets there.

## AWS deployment

See [infra/README.md](infra/README.md) for the architecture, a cost breakdown (⏱ = billed per hour) and the
step-by-step first deploy.

## Workflow

See [docs/git-workflow.md](docs/git-workflow.md) for branching and PRs, and [docs/ci-cd.md](docs/ci-cd.md) for the
pipeline, GitHub/AWS setup and rollback.

## Roadmap

1. ✅ Monorepo, configs, hello-world web, API `/health`
2. ✅ Multi-stage Dockerfiles + docker compose
3. ✅ AWS CDK stack (VPC, ECR, ECS, ALB, S3, CloudFront)
4. ✅ GitHub Actions PR checks + auto deploy (OIDC)
5. ✅ Prisma schema, RDS, migrations in pipeline
6. Web layout + home page
7. Video upload API (presigned URL / multipart / local)
8. Record + settings pages
9. Worker: SQS processing, DLQ, status updates
