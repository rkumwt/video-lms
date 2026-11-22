import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { describe, expect, it } from 'vitest';

import { type VlpConfig } from '../lib/config';
import { buildVlpApp } from '../lib/vlp-app';

const baseConfig: VlpConfig = {
  appName: 'vlp',
  region: 'ap-south-1',
  availabilityZones: ['ap-south-1a', 'ap-south-1b'],
  alertEmail: 'alerts@example.com',
  monthlyBudgetUsd: 30,
  api: { cpu: 256, memoryMiB: 512, desiredCount: 1 },
  worker: { cpu: 256, memoryMiB: 512, desiredCount: 1, useSpot: true },
  logRetention: RetentionDays.TWO_WEEKS,
  githubRepo: 'acme/video-lms',
  githubOwnerId: '111',
  githubRepoId: '222',
  githubOidcProviderExists: true,
  webOrigins: ['https://app.example.com'],
};

function synth(overrides: Partial<VlpConfig> = {}) {
  const app = new App();
  const stacks = buildVlpApp(app, { ...baseConfig, ...overrides });
  // Runs the cdk-nag validation plugin; throws if any unacknowledged finding exists.
  app.synth();
  return {
    network: Template.fromStack(stacks.network),
    foundation: Template.fromStack(stacks.foundation),
    app: Template.fromStack(stacks.appStack),
    cicd: Template.fromStack(stacks.cicd),
    data: Template.fromStack(stacks.data),
    migrate: Template.fromStack(stacks.migrate),
  };
}

describe('cdk-nag', () => {
  it('synthesizes with no unacknowledged AwsSolutions findings', () => {
    expect(() => synth({ imageTag: 'abc123' })).not.toThrow();
  });
});

describe('NetworkStack', () => {
  const { network } = synth();

  it('has no NAT gateways (cost)', () => {
    network.resourceCountIs('AWS::EC2::NatGateway', 0);
  });

  it('has 2 public + 2 isolated subnets', () => {
    network.resourceCountIs('AWS::EC2::Subnet', 4);
  });

  it('has a free S3 gateway endpoint', () => {
    network.hasResourceProperties('AWS::EC2::VPCEndpoint', { VpcEndpointType: 'Gateway' });
  });
});

describe('FoundationStack', () => {
  const { foundation } = synth();

  it('creates immutable, scanned ECR repos', () => {
    foundation.resourceCountIs('AWS::ECR::Repository', 2);
    foundation.allResourcesProperties('AWS::ECR::Repository', {
      ImageTagMutability: 'IMMUTABLE',
      ImageScanningConfiguration: { ScanOnPush: true },
    });
  });

  it('keeps the videos bucket private, encrypted and retained', () => {
    foundation.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      Properties: Match.objectLike({
        PublicAccessBlockConfiguration: Match.objectLike({ BlockPublicAcls: true }),
        BucketEncryption: Match.anyValue(),
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({ AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } }),
          ]),
        },
      }),
    });
  });

  it('creates a monthly cost budget', () => {
    foundation.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: Match.objectLike({ BudgetLimit: { Amount: 30, Unit: 'USD' }, TimeUnit: 'MONTHLY' }),
    });
  });
});

describe('AppStack', () => {
  it('runs nothing until an image tag is provided (safe first deploy)', () => {
    const { app } = synth();
    app.allResourcesProperties('AWS::ECS::Service', { DesiredCount: 0 });
  });

  it('runs api on Fargate and worker on Fargate Spot, both ARM64', () => {
    const { app } = synth({ imageTag: 'abc123' });
    app.hasResourceProperties('AWS::ECS::Service', {
      ServiceName: 'api',
      DesiredCount: 1,
      CapacityProviderStrategy: [{ CapacityProvider: 'FARGATE', Weight: 1 }],
      DeploymentConfiguration: Match.objectLike({
        DeploymentCircuitBreaker: { Enable: true, Rollback: true },
      }),
    });
    app.hasResourceProperties('AWS::ECS::Service', {
      ServiceName: 'worker',
      CapacityProviderStrategy: [{ CapacityProvider: 'FARGATE_SPOT', Weight: 1 }],
    });
    app.allResourcesProperties('AWS::ECS::TaskDefinition', {
      RuntimePlatform: { CpuArchitecture: 'ARM64', OperatingSystemFamily: 'LINUX' },
    });
  });

  it('never opens the ALB to the whole internet', () => {
    const { app } = synth();
    type Rule = { CidrIp?: string; CidrIpv6?: string };
    const groups = app.findResources('AWS::EC2::SecurityGroup');
    const ingress = app.findResources('AWS::EC2::SecurityGroupIngress');
    const rules: Rule[] = [
      ...Object.values(groups).flatMap(
        (g) => (g.Properties as { SecurityGroupIngress?: Rule[] }).SecurityGroupIngress ?? [],
      ),
      ...Object.values(ingress).map((r) => r.Properties as Rule),
    ];
    expect(rules.some((r) => r.CidrIp === '0.0.0.0/0' || r.CidrIpv6 === '::/0')).toBe(false);
    app.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      FromPort: 80,
      SourcePrefixListId: Match.anyValue(), // CloudFront origin-facing managed prefix list
    });
  });

  it('routes /api/* from CloudFront to the ALB without caching', () => {
    const { app } = synth();
    app.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: 'index.html',
        CacheBehaviors: [
          Match.objectLike({
            PathPattern: '/api/*',
            ViewerProtocolPolicy: 'https-only',
            CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad', // Managed-CachingDisabled
          }),
        ],
      }),
    });
  });
});

describe('CiCdStack', () => {
  it('imports the existing GitHub OIDC provider instead of creating a second one', () => {
    const { cicd } = synth();
    cicd.resourceCountIs('Custom::AWSCDKOpenIdConnectProvider', 0);
    cicd.resourceCountIs('AWS::IAM::OIDCProvider', 0);
  });

  it('only trusts this repo (by immutable IDs) on main or the production environment', () => {
    const { cicd } = synth();
    cicd.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'vlp-github-deploy',
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Action: 'sts:AssumeRoleWithWebIdentity',
            Condition: {
              StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
              StringLike: {
                'token.actions.githubusercontent.com:sub': [
                  'repo:acme@111/video-lms@222:ref:refs/heads/main',
                  'repo:acme@111/video-lms@222:environment:production',
                ],
              },
            },
          }),
        ],
      },
    });
  });

  it('never grants AdministratorAccess directly', () => {
    const { cicd } = synth();
    expect(JSON.stringify(cicd.toJSON())).not.toContain('AdministratorAccess');
  });
});

describe('DataStack', () => {
  const { data } = synth();

  it('runs a small, private, encrypted, protected PostgreSQL 17', () => {
    data.hasResource('AWS::RDS::DBInstance', {
      DeletionPolicy: 'Snapshot',
      Properties: Match.objectLike({
        Engine: 'postgres',
        EngineVersion: Match.stringLikeRegexp('^17'),
        DBInstanceClass: 'db.t4g.micro',
        PubliclyAccessible: false,
        StorageEncrypted: true,
        DeletionProtection: true,
        MultiAZ: false,
      }),
    });
  });

  it('keeps credentials in Secrets Manager', () => {
    data.resourceCountIs('AWS::SecretsManager::Secret', 1);
  });

  it('has no ingress rules of its own (consumers add them, avoiding stack cycles)', () => {
    data.resourceCountIs('AWS::EC2::SecurityGroupIngress', 0);
  });
});

describe('MigrateStack', () => {
  const { migrate } = synth({ imageTag: 'abc123' });

  it('runs `prisma migrate deploy` from the api image with DB secrets', () => {
    migrate.hasResourceProperties('AWS::ECS::TaskDefinition', {
      Family: 'vlp-migrate',
      ContainerDefinitions: [
        Match.objectLike({
          Command: ['sh', '/app/scripts/migrate.sh'],
          Secrets: Match.arrayWith([Match.objectLike({ Name: 'DB_PASSWORD' })]),
        }),
      ],
    });
  });

  it('opens PostgreSQL to the migration task only on 5432', () => {
    migrate.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      IpProtocol: 'tcp',
      FromPort: 5432,
      ToPort: 5432,
    });
  });
});

describe('AppStack database access', () => {
  it('injects DB credentials as secrets, never as plain environment variables', () => {
    const { app } = synth({ imageTag: 'abc123' });
    const taskDefs = app.findResources('AWS::ECS::TaskDefinition');
    for (const td of Object.values(taskDefs)) {
      const [container] = (td.Properties as { ContainerDefinitions: Record<string, unknown>[] })
        .ContainerDefinitions;
      const envNames = ((container!.Environment ?? []) as { Name: string }[]).map((e) => e.Name);
      const secretNames = ((container!.Secrets ?? []) as { Name: string }[]).map((e) => e.Name);
      expect(envNames).not.toContain('DB_PASSWORD');
      expect(secretNames).toContain('DB_PASSWORD');
      expect(envNames).toContain('DB_SSL_CA');
    }
  });
});

describe('Direct-to-S3 uploads', () => {
  it('allows browser PUT/GET from the app origin and exposes ETag', () => {
    const { foundation } = synth();
    foundation.hasResourceProperties('AWS::S3::Bucket', {
      CorsConfiguration: {
        CorsRules: [
          Match.objectLike({
            AllowedOrigins: ['https://app.example.com'],
            AllowedMethods: Match.arrayWith(['PUT', 'GET']),
            ExposedHeaders: ['ETag'],
          }),
        ],
      },
    });
  });

  it('disables local-disk storage for the API on Fargate', () => {
    const { app } = synth({ imageTag: 'abc123' });
    app.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: [
        Match.objectLike({
          Name: 'api',
          Environment: Match.arrayWith([{ Name: 'STORAGE_LOCAL_ENABLED', Value: 'false' }]),
        }),
      ],
    });
  });
});
