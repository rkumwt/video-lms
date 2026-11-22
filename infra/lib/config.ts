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
  };
}
