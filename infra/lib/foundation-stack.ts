import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  Validations,
  type StackProps,
} from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cw from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
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
  readonly videoEventsQueue: sqs.Queue;
  readonly videoEventsDlq: sqs.Queue;

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
      // Browsers upload straight to S3 with presigned URLs (single PUT or multipart parts).
      cors: [
        {
          allowedOrigins: config.webOrigins,
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedHeaders: ['Content-Type', 'Content-Length'],
          exposedHeaders: ['ETag'], // needed to complete multipart uploads
          maxAge: 3600,
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
    // ---- Video events queue (API -> worker) + dead-letter queue ---------------
    // Pay per request (first 1M/month free); no hourly cost.
    this.videoEventsDlq = new sqs.Queue(this, 'VideoEventsDlq', {
      queueName: `${config.appName}-video-events-dlq`,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      retentionPeriod: Duration.days(14), // time to inspect and redrive poison messages
    });
    this.videoEventsQueue = new sqs.Queue(this, 'VideoEventsQueue', {
      queueName: `${config.appName}-video-events`,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      // Longer than the worker's worst-case processing time, or messages get processed twice.
      visibilityTimeout: Duration.minutes(5),
      receiveMessageWaitTime: Duration.seconds(20), // long polling: fewer empty receives
      retentionPeriod: Duration.days(4),
      deadLetterQueue: { queue: this.videoEventsDlq, maxReceiveCount: 5 },
    });

    const alarmAction = new cwActions.SnsAction(this.alertsTopic);
    new cw.Alarm(this, 'VideoEventsDlqAlarm', {
      alarmDescription: 'Video events failed 5 times and landed in the DLQ',
      metric: this.videoEventsDlq.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
        statistic: 'Maximum',
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(alarmAction);
    new cw.Alarm(this, 'VideoEventsBacklogAlarm', {
      alarmDescription: 'Oldest video event is older than 15 minutes (worker down or stuck)',
      metric: this.videoEventsQueue.metricApproximateAgeOfOldestMessage({
        period: Duration.minutes(5),
        statistic: 'Maximum',
      }),
      threshold: 15 * 60,
      evaluationPeriods: 1,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(alarmAction);

    Validations.of(this.videoEventsDlq).acknowledge({
      id: 'AwsSolutions-SQS3',
      reason: 'This queue IS the dead-letter queue.',
    });

    new CfnOutput(this, 'VideoEventsQueueUrl', { value: this.videoEventsQueue.queueUrl });
    new CfnOutput(this, 'VideoEventsDlqUrl', { value: this.videoEventsDlq.queueUrl });
    new CfnOutput(this, 'ApiRepoUri', { value: this.apiRepo.repositoryUri });
    new CfnOutput(this, 'WorkerRepoUri', { value: this.workerRepo.repositoryUri });
    new CfnOutput(this, 'VideosBucketName', { value: this.videosBucket.bucketName });

    Validations.of(this.videosBucket).acknowledge({
      id: 'AwsSolutions-S1',
      reason: 'Server access logs cost extra storage; CloudTrail data events can be added later.',
    });
  }
}
