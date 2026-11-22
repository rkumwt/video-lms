import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  Validations,
  type StackProps,
} from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import { type Construct } from 'constructs';

import { type VlpConfig } from './config';

export interface FoundationStackProps extends StackProps {
  config: VlpConfig;
}

/**
 * Long-lived, (mostly) stateful resources with no hourly cost:
 * ECR repositories, the videos bucket, the alerts topic and the monthly budget.
 * Kept separate so the App stack (which does cost money per hour) can be destroyed and
 * re-created freely without losing data or images.
 */
export class FoundationStack extends Stack {
  readonly apiRepo: ecr.Repository;
  readonly workerRepo: ecr.Repository;
  readonly videosBucket: s3.Bucket;
  readonly alertsTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, props);
    const { config } = props;

    // ---- ECR ----------------------------------------------------------------
    const repo = (name: string) =>
      new ecr.Repository(this, `${name[0]!.toUpperCase()}${name.slice(1)}Repo`, {
        repositoryName: `${config.appName}/${name}`,
        imageTagMutability: ecr.TagMutability.IMMUTABLE, // a SHA always means the same image
        imageScanOnPush: true,
        encryption: ecr.RepositoryEncryption.AES_256,
        lifecycleRules: [{ description: 'Keep the last 15 images', maxImageCount: 15 }],
        // Images are rebuildable from git, so the repos can go with the stack.
        removalPolicy: RemovalPolicy.DESTROY,
        emptyOnDelete: true,
      });
    this.apiRepo = repo('api');
    this.workerRepo = repo('worker');

    // ---- Videos bucket --------------------------------------------------------
    this.videosBucket = new s3.Bucket(this, 'VideosBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      lifecycleRules: [
        {
          id: 'abort-incomplete-multipart',
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
        {
          id: 'intelligent-tiering',
          // Moves rarely watched videos to cheaper tiers automatically, no retrieval fees.
          transitions: [
            {
              storageClass: s3.StorageClass.INTELLIGENT_TIERING,
              transitionAfter: Duration.days(0),
            },
          ],
        },
      ],
      // User data: never deleted by `cdk destroy`.
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // ---- Alerts ---------------------------------------------------------------
    this.alertsTopic = new sns.Topic(this, 'AlertsTopic', {
      displayName: `${config.appName} alerts`,
      enforceSSL: true,
    });
    this.alertsTopic.addSubscription(new subs.EmailSubscription(config.alertEmail));

    // ---- Budget (free for the first two budgets) -----------------------------
    const notify = (
      threshold: number,
      notificationType: 'ACTUAL' | 'FORECASTED',
    ): budgets.CfnBudget.NotificationWithSubscribersProperty => ({
      notification: {
        comparisonOperator: 'GREATER_THAN',
        notificationType,
        threshold,
        thresholdType: 'PERCENTAGE',
      },
      subscribers: [{ subscriptionType: 'EMAIL', address: config.alertEmail }],
    });

    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: `${config.appName}-monthly`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: config.monthlyBudgetUsd, unit: 'USD' },
      },
      notificationsWithSubscribers: [
        notify(50, 'ACTUAL'),
        notify(80, 'ACTUAL'),
        notify(100, 'ACTUAL'),
        notify(100, 'FORECASTED'),
      ],
    });

    // ---- Outputs --------------------------------------------------------------
    new CfnOutput(this, 'ApiRepoUri', { value: this.apiRepo.repositoryUri });
    new CfnOutput(this, 'WorkerRepoUri', { value: this.workerRepo.repositoryUri });
    new CfnOutput(this, 'VideosBucketName', { value: this.videosBucket.bucketName });

    Validations.of(this.videosBucket).acknowledge({
      id: 'AwsSolutions-S1',
      reason: 'Server access logs cost extra storage; CloudTrail data events can be added later.',
    });
  }
}
