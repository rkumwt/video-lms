# CI/CD

GitHub Actions + GitHub OIDC → AWS. No AWS keys are stored in GitHub.

```
pull request ──► CI (.github/workflows/ci.yml)
                 ├─ Checks            PR title commitlint · prettier · turbo lint/typecheck/test/build
                 │                    (infra tests = CDK synth + cdk-nag + assertions)   ← required
                 └─ Docker build ×3   api / worker / web on native arm64 runners (no push)

merge to main ──► Deploy (.github/workflows/deploy.yml)   concurrency: deploy-production (queued)
                 1. CI            (same workflow, re-run on the merge commit)
                 2. Images ×2     OIDC → ECR push  vlp/{api,worker}:<sha12>  (skipped if tag exists)
                 3. Deploy        environment: production
                    ├─ cdk deploy Network, Foundation, Data (RDS), Migrate (task def, new image)
                    ├─ run-migrations.sh: one-off Fargate task `prisma migrate deploy` (must exit 0)
                    ├─ cdk deploy App        → ECS rolling update + circuit breaker
                    ├─ web: s3 sync (immutable assets, index.html no-cache) + CloudFront invalidation
                    └─ smoke test: /api/health must report the new <sha12>
```

## Why this shape (industry patterns)

| Practice                                        | Here                                                                                                                                                                                          |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trunk-based, short-lived branches, squash merge | `feat/<n>-<slug>` → PR → squash into `main`. The PR title is the commit message, and it's linted.                                                                                             |
| Required status checks                          | `Checks` must pass before merge (ruleset on `main`).                                                                                                                                          |
| Short-lived cloud credentials (OIDC)            | `vlp-github-deploy` role trusts only `repo:rkumwt/video-lms` on `main` / environment `production`; sessions max 1 h.                                                                          |
| Least privilege, pipeline can't escalate itself | The role can only assume the CDK bootstrap roles, push to 2 ECR repos, write the web bucket and invalidate CloudFront. `Vlp-CiCd` (the role itself) is deployed by an admin, **never** by CI. |
| Build once, immutable artifacts                 | Image tag = first 12 chars of the commit SHA; ECR tags are immutable; `/health` reports the SHA.                                                                                              |
| Safe rollouts                                   | ECS rolling deploy (min 100% / max 200%) with **deployment circuit breaker + automatic rollback**. Failed health checks roll back to the previous task definition.                            |
| Serialized deploys                              | `concurrency: deploy-production`, `cancel-in-progress: false`.                                                                                                                                |
| Verify after deploy                             | Smoke test polls `/api/health` until it reports the new version.                                                                                                                              |
| Caching                                         | pnpm store (setup-node), Turborepo local cache (actions/cache), Docker layers (GitHub Actions cache).                                                                                         |
| Dependency hygiene                              | Dependabot weekly: grouped npm minor/patch, Actions, Docker base images.                                                                                                                      |

## One-time setup (already done for this repo)

1. **AWS:** deploy the OIDC role (admin credentials, once):
   ```bash
   AWS_PROFILE=vlp CDK_DEFAULT_ACCOUNT=<acct> CDK_DEFAULT_REGION=ap-south-1 VLP_ALERT_EMAIL=<email> \
     pnpm --filter @vlp/infra cdk deploy Vlp-CiCd --exclusively
   ```
   An AWS account can have only one GitHub OIDC provider. If none exists yet, add
   `-c githubOidcProviderExists=false` and CDK will create it.
2. **GitHub → Settings → Secrets and variables → Actions**
   - Variables: `AWS_REGION`, `AWS_ACCOUNT_ID`, `AWS_DEPLOY_ROLE_ARN` (the `Vlp-CiCd.DeployRoleArn` output)
   - Secret: `VLP_ALERT_EMAIL`
3. **GitHub → Settings → Environments → `production`**: deployment branches = `main` only.
   Optionally add yourself as a _required reviewer_, which gives you a manual approval gate before every deploy.
4. **GitHub → Settings → General → Pull Requests**: squash merging only (default message = PR title and
   description), always suggest updating branches. _Automatically delete head branches_ stays **off**:
   merged phase branches are kept for review (see [git-workflow.md](git-workflow.md)).
5. **GitHub → Settings → Rules → Rulesets → `main`**: restrict deletions, block force pushes,
   require linear history, require a pull request, require status check `Checks`.

## Everyday flow

```bash
git switch main && git pull
git switch -c feat/5-db
# ...commit (Conventional Commits; husky + commitlint enforce it)...
git push -u origin feat/5-db
# open PR with a Conventional Commit title → CI → Squash and merge → Deploy runs automatically
```

## Troubleshooting

**`Could not assume role with OIDC: Not authorized to perform sts:AssumeRoleWithWebIdentity`**:
the token's `sub` claim doesn't match the trust policy. Look up the exact subject GitHub sent:

```bash
aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=AssumeRoleWithWebIdentity \
  --max-results 5 --query 'Events[].CloudTrailEvent' --output text | jq -r '.userIdentity.userName, .errorCode'
```

GitHub now uses `repo:<owner>@<ownerId>/<repo>@<repoId>:...`. The IDs are set in `infra/lib/config.ts`
(`githubOwnerId`, `githubRepoId`). Fix them, then run `cdk deploy Vlp-CiCd --exclusively` with admin credentials.

## Rollback

- **Automatic:** if new tasks fail the load balancer health checks, the ECS circuit breaker rolls back
  and the workflow fails.
- **Manual, fastest:** re-run the Deploy workflow for an earlier commit from the Actions tab
  (`Run workflow` on `main` deploys `HEAD`). Alternatively revert the bad PR on GitHub, which creates a
  revert PR, then merge it to redeploy the previous code.
- **Emergency (bypasses CI):** with admin credentials:
  ```bash
  VLP_IMAGE_TAG=<previous sha12> pnpm --filter @vlp/infra cdk deploy Vlp-App
  ```

## Costs

GitHub Actions minutes are free for public repositories, including the arm64 runners. The pipeline
itself adds no AWS cost beyond the small amount of ECR storage. Lifecycle rules keep the last 15 images.
