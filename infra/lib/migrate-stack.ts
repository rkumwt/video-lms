import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  Validations,
  type StackProps,
} from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import type * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { type Construct } from 'constructs';

import { type VlpConfig } from './config';
import { allowDbAccess, dbEnvironment, dbSecrets } from './db-access';

export interface MigrateStackProps extends StackProps {
  config: VlpConfig;
  vpc: ec2.IVpc;
  apiRepo: ecr.IRepository;
  dbSecurityGroup: ec2.ISecurityGroup;
  dbSecret: secretsmanager.ISecret;
}

/**
 * One-off "migrate" task: the API image running `prisma migrate deploy`.
 *
 * The pipeline deploys this stack with the NEW image tag, runs the task and waits for exit code 0,
 * and only then deploys Vlp-App (which rolls the services). Kept in its own stack with its own
 * (free) ECS cluster so migrations work even if Vlp-App has been destroyed to save cost.
 */
export class MigrateStack extends Stack {
  constructor(scope: Construct, id: string, props: MigrateStackProps) {
    super(scope, id, props);
    const { config, vpc } = props;
    const imageTag = config.imageTag ?? 'none';

    const cluster = new ecs.Cluster(this, 'JobsCluster', {
      vpc,
      clusterName: `${config.appName}-jobs`,
      containerInsightsV2: ecs.ContainerInsights.DISABLED,
    });

    const logGroup = new logs.LogGroup(this, 'MigrateLogs', {
      logGroupName: `/ecs/${config.appName}/migrate`,
      retention: config.logRetention,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const task = new ecs.FargateTaskDefinition(this, 'MigrateTask', {
      family: `${config.appName}-migrate`,
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    task.addContainer('migrate', {
      image: ecs.ContainerImage.fromEcrRepository(props.apiRepo, imageTag),
      command: ['sh', '/app/scripts/migrate.sh'],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'migrate', logGroup }),
      environment: { NODE_ENV: 'production', APP_VERSION: imageTag, ...dbEnvironment },
      secrets: dbSecrets(props.dbSecret),
      stopTimeout: Duration.seconds(30),
    });

    const sg = new ec2.SecurityGroup(this, 'MigrateSg', {
      vpc,
      description: 'Migration task - no inbound traffic',
    });
    allowDbAccess(props.dbSecurityGroup, sg, 'Migrations');

    const publicSubnets = vpc.selectSubnets({ subnetType: ec2.SubnetType.PUBLIC });

    // Read by scripts/deploy/run-migrations.sh
    new CfnOutput(this, 'ClusterName', { value: cluster.clusterName });
    new CfnOutput(this, 'TaskDefinitionArn', { value: task.taskDefinitionArn });
    new CfnOutput(this, 'SecurityGroupId', { value: sg.securityGroupId });
    new CfnOutput(this, 'SubnetIds', { value: publicSubnets.subnetIds.join(',') });
    new CfnOutput(this, 'LogGroupName', { value: logGroup.logGroupName });

    Validations.of(this).acknowledge(
      {
        id: 'AwsSolutions-ECS4',
        reason: 'Container Insights is billed per metric; not needed for a one-off job cluster.',
      },
      {
        id: 'AwsSolutions-ECS2',
        reason: 'Plain env vars are non-secret config only; DB credentials use Secrets Manager.',
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'ECR GetAuthorizationToken and CloudWatch Logs stream ARNs require wildcards.',
      },
    );
  }
}
