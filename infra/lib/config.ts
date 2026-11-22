import { type App } from 'aws-cdk-lib';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';

export interface ServiceSize {
  /** Fargate CPU units (256 = 0.25 vCPU). */
  cpu: number;
  memoryMiB: number;
  desiredCount: number;
}

export interface VlpConfig {
  /** Short prefix used in resource names, e.g. `vlp`. */
  appName: string;
  account?: string;
  region: string;
  /** Two AZs are enough for an MVP and required by the ALB. */
  availabilityZones: string[];
  /** Receives budget + alarm emails. Required for deploys. */
  alertEmail: string;
  monthlyBudgetUsd: number;
  /**
   * Image tag (git SHA) to run. When undefined, services are created with desiredCount 0 so the
   * very first deploy succeeds before any image exists in ECR.
   */
  imageTag?: string;
  api: ServiceSize;
  worker: ServiceSize & { useSpot: boolean };
  logRetention: RetentionDays;
  /** `owner/name` of the GitHub repo allowed to deploy via OIDC. */
  githubRepo: string;
  /**
   * Immutable numeric IDs of the repo owner and repo. GitHub's OIDC `sub` claim uses the form
   * `repo:<owner>@<ownerId>/<repo>@<repoId>:...`, so a deleted-and-recreated repo with the same
   * name can never assume the role. Find them with:
   *   curl -s https://api.github.com/repos/<owner>/<repo> | jq '.owner.id, .id'
   */
  githubOwnerId: string;
  githubRepoId: string;
  /** The account already has the GitHub OIDC provider (only one is allowed per account). */
  githubOidcProviderExists: boolean;
}

/**
 * Reads deploy-time settings from CDK context (`-c key=value`) or environment variables.
 * Nothing secret lives here — secrets go to Secrets Manager.
 */
export function loadConfig(app: App): VlpConfig {
  const ctx = (key: string): string | undefined => {
    const v: unknown = app.node.tryGetContext(key);
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };

  const region = ctx('region') ?? process.env.CDK_DEFAULT_REGION ?? 'ap-south-1';
  const alertEmail = ctx('alertEmail') ?? process.env.VLP_ALERT_EMAIL;
  if (!alertEmail) {
    throw new Error(
      'Missing alert email. Pass `-c alertEmail=you@example.com` or set VLP_ALERT_EMAIL.',
    );
  }

  return {
    appName: 'vlp',
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region,
    availabilityZones: [`${region}a`, `${region}b`],
    alertEmail,
    monthlyBudgetUsd: Number(ctx('monthlyBudgetUsd') ?? 50),
    imageTag: ctx('imageTag') ?? process.env.VLP_IMAGE_TAG,
    api: { cpu: 256, memoryMiB: 512, desiredCount: 1 },
    worker: { cpu: 256, memoryMiB: 512, desiredCount: 1, useSpot: true },
    logRetention: RetentionDays.TWO_WEEKS,
    githubRepo: ctx('githubRepo') ?? 'rkumwt/video-lms',
    githubOwnerId: ctx('githubOwnerId') ?? '21355037',
    githubRepoId: ctx('githubRepoId') ?? '1467775537',
    githubOidcProviderExists: (ctx('githubOidcProviderExists') ?? 'true') === 'true',
  };
}
