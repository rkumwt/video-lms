import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  Validations,
  type StackProps,
} from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cw from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import type * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type * as sns from 'aws-cdk-lib/aws-sns';
import * as cr from 'aws-cdk-lib/custom-resources';
import { type Construct } from 'constructs';

import { type VlpConfig } from './config';

export interface AppStackProps extends StackProps {
  config: VlpConfig;
  vpc: ec2.IVpc;
  apiRepo: ecr.IRepository;
  workerRepo: ecr.IRepository;
  videosBucket: s3.IBucket;
  alertsTopic: sns.ITopic;
}

const API_PORT = 4000;

/**
 * Everything that runs (and costs money per hour): ECS Fargate services, the ALB and CloudFront.
 *
 *   browser ──HTTPS──► CloudFront ──┬─ /*      ─► S3 web bucket (OAC, private)
 *                                   └─ /api/*  ─► ALB :80 (CloudFront IPs only) ─► api tasks
 *   worker tasks (no inbound traffic)
 */
export class AppStack extends Stack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);
    const { config, vpc } = props;
    const imageTag = config.imageTag ?? 'none';
    const hasImage = config.imageTag !== undefined;
    const publicSubnets = { subnetType: ec2.SubnetType.PUBLIC };
    const runtimePlatform = {
      cpuArchitecture: ecs.CpuArchitecture.ARM64, // Graviton: ~20% cheaper than x86
      operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
    };

    // ---- ECS cluster ----------------------------------------------------------
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      clusterName: config.appName,
      enableFargateCapacityProviders: true,
      // Container Insights costs extra per metric; basic ECS metrics are free.
      containerInsightsV2: ecs.ContainerInsights.DISABLED,
    });

    // ---- ALB: reachable only from CloudFront ---------------------------------
    const cfPrefixList = new cr.AwsCustomResource(this, 'CloudFrontPrefixList', {
      onUpdate: {
        service: 'EC2',
        action: 'describeManagedPrefixLists',
        parameters: {
          Filters: [
            { Name: 'prefix-list-name', Values: ['com.amazonaws.global.cloudfront.origin-facing'] },
          ],
        },
        physicalResourceId: cr.PhysicalResourceId.of('cloudfront-origin-facing'),
        outputPaths: ['PrefixLists.0.PrefixListId'],
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
      installLatestAwsSdk: false,
    });

    const albSg = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc,
      description: 'ALB - HTTP from CloudFront origin-facing IPs only',
      allowAllOutbound: false,
    });
    albSg.addIngressRule(
      ec2.Peer.prefixList(cfPrefixList.getResponseField('PrefixLists.0.PrefixListId')),
      ec2.Port.tcp(80),
      'CloudFront origin-facing',
    );

    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      vpcSubnets: publicSubnets,
      internetFacing: true,
      securityGroup: albSg,
      dropInvalidHeaderFields: true,
    });
    const listener = alb.addListener('Http', {
      port: 80,
      open: false,
      defaultAction: elbv2.ListenerAction.fixedResponse(404, {
        contentType: 'application/json',
        messageBody: '{"error":{"code":"NOT_FOUND","message":"Not found"}}',
      }),
    });

    // ---- Web bucket + CloudFront ---------------------------------------------
    const webBucket = new s3.Bucket(this, 'WebBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      // Build output only: safe to delete with the stack.
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // SPA routing without distribution-wide error pages (those would also rewrite API 404s).
    const spaRewrite = new cloudfront.Function(this, 'SpaRewrite', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: 'Serve index.html for client-side routes',
      code: cloudfront.FunctionCode.fromInline(
        [
          'function handler(event) {',
          '  var request = event.request;',
          "  if (!request.uri.includes('.')) { request.uri = '/index.html'; }",
          '  return request;',
          '}',
        ].join('\n'),
      ),
    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `${config.appName} web + api`,
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200, // includes India / Asia edges
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(webBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        compress: true,
        functionAssociations: [
          { function: spaRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
        ],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.LoadBalancerV2Origin(alb, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
            readTimeout: Duration.seconds(60),
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
    });
    const appOrigin = `https://${distribution.distributionDomainName}`;

    // ---- API service ----------------------------------------------------------
    const apiLogs = new logs.LogGroup(this, 'ApiLogs', {
      logGroupName: `/ecs/${config.appName}/api`,
      retention: config.logRetention,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const apiTask = new ecs.FargateTaskDefinition(this, 'ApiTask', {
      cpu: config.api.cpu,
      memoryLimitMiB: config.api.memoryMiB,
      runtimePlatform,
    });
    apiTask.addContainer('api', {
      image: ecs.ContainerImage.fromEcrRepository(props.apiRepo, imageTag),
      portMappings: [{ containerPort: API_PORT }],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'api', logGroup: apiLogs }),
      environment: {
        NODE_ENV: 'production',
        PORT: String(API_PORT),
        LOG_LEVEL: 'info',
        APP_VERSION: imageTag,
        CORS_ORIGIN: appOrigin,
        AWS_REGION: this.region,
        VIDEOS_BUCKET: props.videosBucket.bucketName,
      },
      stopTimeout: Duration.seconds(30),
    });
    props.videosBucket.grantReadWrite(apiTask.taskRole);

    const apiSg = new ec2.SecurityGroup(this, 'ApiSg', {
      vpc,
      description: 'API tasks - inbound from ALB only',
    });
    const apiService = new ecs.FargateService(this, 'ApiService', {
      cluster,
      serviceName: 'api',
      taskDefinition: apiTask,
      desiredCount: hasImage ? config.api.desiredCount : 0,
      vpcSubnets: publicSubnets,
      assignPublicIp: true, // needed to reach ECR/CloudWatch without a NAT gateway
      securityGroups: [apiSg],
      capacityProviderStrategies: [{ capacityProvider: 'FARGATE', weight: 1 }],
      circuitBreaker: { enable: true, rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      healthCheckGracePeriod: Duration.seconds(30),
      enableExecuteCommand: true,
    });

    const apiTargets = listener.addTargets('Api', {
      priority: 10,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/api/*', '/health'])],
      port: API_PORT,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [apiService],
      deregistrationDelay: Duration.seconds(15),
      healthCheck: {
        path: '/health',
        interval: Duration.seconds(15),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    // ---- Worker service -------------------------------------------------------
    const workerLogs = new logs.LogGroup(this, 'WorkerLogs', {
      logGroupName: `/ecs/${config.appName}/worker`,
      retention: config.logRetention,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const workerTask = new ecs.FargateTaskDefinition(this, 'WorkerTask', {
      cpu: config.worker.cpu,
      memoryLimitMiB: config.worker.memoryMiB,
      runtimePlatform,
    });
    workerTask.addContainer('worker', {
      image: ecs.ContainerImage.fromEcrRepository(props.workerRepo, imageTag),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'worker', logGroup: workerLogs }),
      environment: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
        APP_VERSION: imageTag,
        AWS_REGION: this.region,
        VIDEOS_BUCKET: props.videosBucket.bucketName,
      },
      stopTimeout: Duration.seconds(30),
    });
    props.videosBucket.grantReadWrite(workerTask.taskRole);

    const workerSg = new ec2.SecurityGroup(this, 'WorkerSg', {
      vpc,
      description: 'Worker tasks - no inbound traffic',
    });
    const workerService = new ecs.FargateService(this, 'WorkerService', {
      cluster,
      serviceName: 'worker',
      taskDefinition: workerTask,
      desiredCount: hasImage ? config.worker.desiredCount : 0,
      vpcSubnets: publicSubnets,
      assignPublicIp: true,
      securityGroups: [workerSg],
      // Spot is ~70% cheaper; a queue consumer tolerates the occasional interruption.
      capacityProviderStrategies: [
        { capacityProvider: config.worker.useSpot ? 'FARGATE_SPOT' : 'FARGATE', weight: 1 },
      ],
      circuitBreaker: { enable: true, rollback: true },
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      enableExecuteCommand: true,
    });

    // ---- Alarms -> SNS email ($0.10 per alarm per month) ----------------------
    const alarmAction = new cwActions.SnsAction(props.alertsTopic);
    const alarms = [
      new cw.Alarm(this, 'Api5xxAlarm', {
        alarmDescription: 'API returned 5xx responses',
        metric: alb.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, {
          period: Duration.minutes(5),
          statistic: 'Sum',
        }),
        threshold: 5,
        evaluationPeriods: 1,
        comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cw.TreatMissingData.NOT_BREACHING,
      }),
      new cw.Alarm(this, 'ApiUnhealthyAlarm', {
        alarmDescription: 'ALB has unhealthy API targets',
        metric: apiTargets.metrics.unhealthyHostCount({
          period: Duration.minutes(1),
          statistic: 'Maximum',
        }),
        threshold: 1,
        evaluationPeriods: 3,
        comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cw.TreatMissingData.NOT_BREACHING,
      }),
      new cw.Alarm(this, 'ApiCpuAlarm', {
        alarmDescription: 'API CPU above 85% for 15 minutes',
        metric: apiService.metricCpuUtilization({ period: Duration.minutes(5) }),
        threshold: 85,
        evaluationPeriods: 3,
        treatMissingData: cw.TreatMissingData.NOT_BREACHING,
      }),
    ];
    alarms.forEach((a) => a.addAlarmAction(alarmAction));

    // ---- Outputs (consumed by the deploy workflow in Phase 4) -----------------
    new CfnOutput(this, 'AppUrl', { value: appOrigin });
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new CfnOutput(this, 'WebBucketName', { value: webBucket.bucketName });
    new CfnOutput(this, 'AlbDnsName', { value: alb.loadBalancerDnsName });
    new CfnOutput(this, 'ClusterName', { value: cluster.clusterName });
    new CfnOutput(this, 'ApiServiceName', { value: apiService.serviceName });
    new CfnOutput(this, 'WorkerServiceName', { value: workerService.serviceName });

    // ---- cdk-nag: documented, intentional exceptions ---------------------------
    Validations.of(this).acknowledge(
      {
        id: 'AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]',
        reason: 'AWS managed policy used only by the CDK-provided custom-resource Lambda.',
      },
      {
        id: 'AwsSolutions-IAM5',
        reason:
          'Wildcards come from CDK grants (bucket object ARNs/*), ECS Exec, and the read-only ' +
          'DescribeManagedPrefixLists call, which does not support resource-level permissions.',
      },
      {
        id: 'AwsSolutions-L1',
        reason: 'Runtime of CDK-managed singleton Lambdas is controlled by aws-cdk-lib.',
      },
      {
        id: 'AwsSolutions-S1',
        reason: 'Access logs for the static web bucket are not needed for the MVP.',
      },
      {
        id: 'AwsSolutions-ELB2',
        reason: 'ALB access logs cost S3 storage; enable when traffic justifies it.',
      },
      {
        id: 'AwsSolutions-EC23',
        reason: 'ALB ingress is restricted to the CloudFront managed prefix list.',
      },
      {
        id: 'AwsSolutions-ECS2',
        reason:
          'Environment variables contain only non-secret config; secrets use Secrets Manager.',
      },
      {
        id: 'AwsSolutions-ECS4',
        reason:
          'Container Insights is billed per metric; free basic ECS metrics are enough for now.',
      },
      {
        id: 'AwsSolutions-CFR1',
        reason: 'No geo restriction required for this product.',
      },
      {
        id: 'AwsSolutions-CFR2',
        reason: 'AWS WAF costs ~$5+/month per web ACL; add when going to production.',
      },
      {
        id: 'AwsSolutions-CFR3',
        reason: 'CloudFront standard logs cost S3 storage; enable when needed.',
      },
      {
        id: 'AwsSolutions-CFR4',
        reason:
          'Default *.cloudfront.net certificate is used until a custom domain + ACM cert is added.',
      },
      {
        id: 'AwsSolutions-CFR5',
        reason: 'ALB origin is HTTP-only (no custom domain/cert yet) and locked to CloudFront IPs.',
      },
    );
  }
}
