# Infrastructure (AWS CDK, TypeScript)

Three stacks, deployed to **ap-south-1 (Mumbai)** by default. You can change it with `-c region=...`.

```
                       ┌─────────────── Vlp-App (costs per hour) ───────────────┐
 browser ──HTTPS──► CloudFront ──┬── /*     ──► S3 web bucket (private, OAC)    │
                       │         └── /api/* ──► ALB :80 ──► ECS Fargate  api    │
                       │              (CloudFront IPs only)  ECS Fargate  worker │
                       └──────────────────────────┬─────────────────────────────┘
 Vlp-Foundation (≈ free): ECR vlp/api, vlp/worker · S3 videos bucket · SNS alerts · Budget
 Vlp-Network    (free):   VPC 10.20.0.0/16 · 2 AZ · public + isolated subnets · S3 gateway endpoint
```

| Stack            | Contents                                                                                                                                                                        | Delete safely?                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `Vlp-Network`    | VPC, subnets, S3 gateway endpoint                                                                                                                                               | Yes, after `Vlp-App`                                                                      |
| `Vlp-Foundation` | ECR repos, videos bucket (retained), SNS alerts topic, monthly budget, SQS `vlp-video-events` + DLQ with alarms. **Termination protection on.**                                 | Bucket is kept on purpose                                                                 |
| `Vlp-Data`       | RDS PostgreSQL 17 `db.t4g.micro`, isolated subnets, encrypted, 7-day backups, deletion protection + **termination protection**, credentials in Secrets Manager (`vlp/db/admin`) | ⏱ costs per hour; snapshot on delete                                                      |
| `Vlp-Migrate`    | `vlp-jobs` cluster + `vlp-migrate` task definition (API image running `prisma migrate deploy`), used by the pipeline                                                            | Yes                                                                                       |
| `Vlp-CiCd`       | GitHub OIDC deploy role `vlp-github-deploy` (imports the account's existing OIDC provider). Deployed by an admin only, never by CI                                              | Yes (CI stops working)                                                                    |
| `Vlp-App`        | ECS cluster + api/worker services, ALB, web bucket, CloudFront, alarms, log groups                                                                                              | **Yes. Destroy it when you are not using the app, so you stop paying for it by the hour** |

## Key decisions

- **No NAT Gateway.** Tasks run in public subnets with a public IP, but their security group only
  accepts traffic from the ALB. A NAT Gateway costs about $33/month per AZ plus data. Interface
  endpoints cost about $7/month each per AZ, and we'd need 4–5 of them. The trade-off is less
  defence-in-depth. To switch later, move the tasks to `PRIVATE_WITH_EGRESS` and set `natGateways: 1`.
  RDS (Phase 5) goes into the **isolated** subnets, which have no internet route at all.
- **The ALB only accepts CloudFront traffic.** Its security group references the AWS-managed
  `com.amazonaws.global.cloudfront.origin-facing` prefix list, which is looked up at deploy time.
- **The browser uses one origin.** CloudFront serves the SPA from S3 and forwards `/api/*` to the
  ALB, so there's no CORS, no mixed content and no custom domain needed. A small CloudFront Function
  rewrites routes like `/record` to `/index.html`, so API 404s are never replaced by HTML.
- **Graviton (ARM64) Fargate.** It's about 20% cheaper than x86, and the images are built `linux/arm64`.
- **Worker on Fargate Spot.** It's about 70% cheaper, and a queue consumer handles interruptions.
- **Safe first deploy.** Without `-c imageTag=<sha>`, both services are created with
  `desiredCount: 0`, so the stack deploys before any image exists in ECR.
- **Rolling deploys** use the ECS **deployment circuit breaker with automatic rollback**.
- **Immutable ECR tags.** A git SHA always means the same image. Lifecycle rules keep the last 15 images.
- **Videos bucket:** private, SSE-S3, TLS-only, abandoned multipart uploads aborted after 1 day,
  and Intelligent-Tiering so rarely watched videos get cheaper automatically. It's retained on delete.
- **cdk-nag (AwsSolutions)** runs on every synth and test. Every intentional exception is
  acknowledged in code with a reason, either a cost reason or a "later phase" note.
- **Cross-stack references are `weak`** (`Fn::GetStackOutput`, the current CDK recommendation), so
  stacks can be updated independently without CloudFormation export deadlocks.

## 💰 Cost (ap-south-1, running 24/7, approximate)

Items marked ⏱ are charged **per hour while they exist**, even with no traffic.

| Resource                              | ⏱   | ~USD / month | Notes                                                                  |
| ------------------------------------- | --- | -----------: | ---------------------------------------------------------------------- |
| Application Load Balancer             | ⏱   |        17–19 | Fixed hourly charge plus LCUs. **The biggest item.**                   |
| Public IPv4 addresses                 | ⏱   |          ~15 | $0.005/h each: 2 for the ALB, 1 per running task                       |
| Fargate api (0.25 vCPU/0.5 GB ARM)    | ⏱   |           ~7 | 1 task                                                                 |
| Fargate worker (Spot)                 | ⏱   |           ~2 | 1 task                                                                 |
| CloudWatch logs + 3 alarms            |     |           ~1 | 2-week retention                                                       |
| CloudFront                            |     |            0 | Always-free tier: 1 TB and 10M requests/month                          |
| S3, ECR                               |     |           <1 | Grows with stored videos (~$0.025/GB-month)                            |
| Budget, SNS, VPC, S3 gateway endpoint |     |            0 |                                                                        |
| **Total**                             |     |  **≈ 40–45** | Comes in Phase 5: RDS db.t4g.micro ⏱ adds about $15/month plus storage |

**Save credits:** `pnpm --filter @vlp/infra cdk destroy Vlp-App` stops every ⏱ item except the
nearly-free Foundation and Network stacks. Re-deploying later takes about 10 minutes, because
CloudFront takes a while.

The **monthly budget** (default $50, change with `-c monthlyBudgetUsd=NN`) emails you at 50%, 80%
and 100% of actual spend, and when the forecast passes 100%.

## Prerequisites

- An AWS account and a user or SSO role with admin rights, used only for bootstrap and the first
  deploy. From Phase 4 on, CI deploys with OIDC.
- AWS CLI v2, Docker (buildx), Node 24, pnpm 9.

```bash
# Sign in (SSO recommended). Creates/uses a named profile; no long-lived keys.
aws configure sso --profile vlp        # or: aws login --profile vlp
export AWS_PROFILE=vlp AWS_REGION=ap-south-1
export CDK_DEFAULT_REGION=$AWS_REGION
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export VLP_ALERT_EMAIL=you@example.com   # budget + alarm emails (not committed anywhere)
```

## First deploy (run from the repo root)

```bash
# 0) One-time per account/region: CDK bootstrap (S3 bucket + roles CDK uses to deploy)
pnpm --filter @vlp/infra cdk bootstrap aws://$CDK_DEFAULT_ACCOUNT/$AWS_REGION

# 1) Network + Foundation (no hourly cost). Confirm the SNS subscription email afterwards.
pnpm --filter @vlp/infra cdk deploy Vlp-Network Vlp-Foundation

# 2) Build & push arm64 images tagged with the git SHA
scripts/deploy/push-images.sh
export VLP_IMAGE_TAG=$(git rev-parse --short=12 HEAD)

# 3) App stack (⏱ starts costing). CloudFront creation takes ~5-10 minutes.
pnpm --filter @vlp/infra cdk deploy Vlp-App

# 4) Upload the web app and invalidate CloudFront
scripts/deploy/deploy-web.sh
```

`cdk deploy` prints the `AppUrl` output. Open it, and the page should show "API ok · v<sha>".

```bash
curl https://<AppUrl>/api/health
```

> ⚠️ Always set `VLP_IMAGE_TAG` (or `-c imageTag=...`) when you deploy `Vlp-App`. Without it the
> services scale to 0. CI (Phase 4) always passes it.

## Everyday commands

```bash
pnpm --filter @vlp/infra synth           # synth + cdk-nag
pnpm --filter @vlp/infra test            # assertion tests (no AWS credentials needed)
pnpm --filter @vlp/infra cdk diff        # ALWAYS before deploy
pnpm --filter @vlp/infra cdk deploy Vlp-App
aws logs tail /ecs/vlp/api --follow      # live API logs
aws ecs execute-command --cluster vlp --task <id> --container api --interactive --command sh
```

The first real synth writes `infra/cdk.context.json` (AZ lookups). **Commit it** so synths are
deterministic.

## Direct uploads (S3 CORS)

The videos bucket allows `PUT/GET/HEAD` from `config.webOrigins` (default: the CloudFront AppUrl and
`http://localhost:5173`) and exposes `ETag` for multipart uploads. For a **new environment**, deploy once,
then add its `AppUrl` with `-c webOrigins=https://<id>.cloudfront.net,http://localhost:5173`.

## Database

- Connect for debugging (no public access, use ECS Exec into an API task):
  ```bash
  aws ecs execute-command --cluster vlp --task <id> --container api --interactive --command sh
  ```
- Pause to save credits: `aws rds stop-db-instance --db-instance-identifier <id>`. AWS restarts it
  automatically after 7 days.
- Credentials: Secrets Manager → `vlp/db/admin`. Tasks receive them as `DB_*` env vars at start.

## Teardown

```bash
pnpm --filter @vlp/infra cdk destroy Vlp-App          # stops hourly costs
pnpm --filter @vlp/infra cdk destroy Vlp-Network      # optional
# Foundation has termination protection + retained videos bucket. To remove it deliberately:
aws cloudformation update-termination-protection --no-enable-termination-protection --stack-name Vlp-Foundation
pnpm --filter @vlp/infra cdk destroy Vlp-Foundation   # bucket stays; empty/delete it in the console
```

## Not yet (planned)

| Item                                         | Phase / when                        |
| -------------------------------------------- | ----------------------------------- |
| GitHub OIDC deploy role                      | 4                                   |
| RDS PostgreSQL + Secrets Manager credentials | 5                                   |
| Custom domain + ACM, WAF, access logs        | Before real users (cost trade-offs) |
