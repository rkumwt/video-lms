# Git workflow & CI/CD pattern

This repo follows **trunk-based development with short-lived feature branches**, which is what most
product teams (and the DORA research) recommend: `main` is always deployable, every change lands via a
small pull request, and merging to `main` deploys automatically.

## Branches

| Branch                       | Purpose                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `main`                       | Protected. Always green, always deployable. Push to `main` = deploy to AWS (Phase 4+). |
| `feat/<n>-<slug>`            | One branch per phase/feature, numbered, e.g. `feat/1-init-monorepo`, `feat/2-docker`.  |
| `fix/<slug>`, `chore/<slug>` | Bug fixes / maintenance outside the phase plan.                                        |

Branches live for days, not weeks. Rebase on `main` before merging to keep history linear.

## Day-to-day loop

```bash
git switch main && git pull
git switch -c feat/2-docker
# ...work, commit with Conventional Commits...
git push -u origin feat/2-docker
gh pr create --fill --base main
# CI runs → review → "Squash and merge" → branch auto-deleted → main deploys
```

**Squash and merge** gives one Conventional Commit per PR on `main`, which keeps history readable and
lets tools (release-please / semantic-release) generate changelogs later.

## One-time GitHub setup

1. **Settings → General → Pull Requests**: enable only _Allow squash merging_, tick
   _Always suggest updating PR branches_ and _Automatically delete head branches_.
2. **Settings → Rules → Rulesets → New branch ruleset** targeting `main`:
   - Restrict deletions, block force pushes
   - Require a pull request before merging (1 approval if you have a reviewer; 0 if solo)
   - Require status checks to pass: `lint`, `typecheck`, `test`, `build` (they appear after the
     first CI run in Phase 4)
   - Require linear history
   - Require branches to be up to date before merging
3. **Settings → Environments → New environment `production`**: optional required reviewer
   (manual approval gate before deploy) and restrict deployments to `main`.
4. **Settings → Code security**: enable Dependabot alerts + security updates, secret scanning and
   push protection.

## CI/CD pattern (implemented in Phase 4)

```
PR opened/updated ──► ci.yml
                      install (pnpm cache) → turbo lint typecheck test build (Turbo cache)
                      ✔ required checks gate the merge

merge to main ─────► deploy.yml (environment: production)
                      1. OIDC → assume AWS role (no long-lived keys in GitHub)
                      2. build api/worker Docker images, tag with git SHA, push to ECR
                      3. run Prisma migrations (one-off ECS task) — Phase 5
                      4. update ECS services → rolling deploy, circuit breaker auto-rollback
                      5. build web → s3 sync → CloudFront invalidation
```

Key industry practices used:

- **GitHub OIDC → IAM role** scoped to this repo and `main` branch (`token.actions.githubusercontent.com`
  trust policy with `sub: repo:<owner>/<repo>:ref:refs/heads/main`). No AWS keys stored as secrets.
- **Immutable image tags** (git SHA), never `latest`, so every deploy is traceable and roll-back-able.
- **Build once, deploy the same artifact**.
- **Migrations before the new code starts**, written to be backward compatible (expand → contract).
- **ECS deployment circuit breaker** for automatic rollback on failed health checks.
- **Concurrency group** on the deploy workflow so two merges never deploy at the same time.
- **Least-privilege** GitHub Actions `permissions:` per workflow (`id-token: write`, `contents: read`).

Only non-secret config (AWS account id, region, role ARN) goes into GitHub **repository variables**.
Runtime secrets (DB password etc.) live in AWS Secrets Manager and are injected into ECS tasks.
