# Learning Video Platform

Record your screen (optionally with camera + mic), save it to local disk or S3, and browse your library.

> **Status:** Phase 1 — monorepo foundation, hello-world web, API `/health`.

## Repository layout

```
apps/
  web/       React + Vite + Tailwind + shadcn/ui (SPA, served by CloudFront on AWS)
  api/       Express 5 REST API (ECS Fargate behind an ALB)
  worker/    Background processor (ECS Fargate, consumes SQS in Phase 9)
packages/
  config/    Shared ESLint flat configs + tsconfig bases
  shared/    Zod schemas + inferred types shared by web, api and worker
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
- Docker (from Phase 2)

## Getting started

```bash
nvm use
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/worker/.env.example apps/worker/.env
cp apps/web/.env.example apps/web/.env
pnpm dev
```

- Web: http://localhost:5173 (shows live API status)
- API: http://localhost:4000/health

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

## Environment variables

Every app ships a `.env.example`. Real `.env` files are git-ignored. On AWS, values come from
ECS task definitions and **Secrets Manager** (Phase 3+). Only `VITE_*` vars reach the browser — never
put secrets there.

## Workflow

See [docs/git-workflow.md](docs/git-workflow.md) for branching, PRs, branch protection and the CI/CD plan.

## Roadmap

1. ✅ Monorepo, configs, hello-world web, API `/health`
2. Multi-stage Dockerfiles + docker-compose
3. AWS CDK stack (VPC, ECR, ECS, ALB, S3, CloudFront)
4. GitHub Actions PR checks + auto deploy (OIDC)
5. Prisma schema, RDS, migrations in pipeline
6. Web layout + home page
7. Video upload API (presigned URL / multipart / local)
8. Record + settings pages
9. Worker: SQS processing, DLQ, status updates
