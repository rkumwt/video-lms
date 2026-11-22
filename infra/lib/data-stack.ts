import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  Validations,
  type StackProps,
} from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { type Construct } from 'constructs';

import { type VlpConfig } from './config';

export interface DataStackProps extends StackProps {
  config: VlpConfig;
  vpc: ec2.IVpc;
}

/**
 * PostgreSQL on RDS: the smallest Graviton instance, single-AZ, in the *isolated* subnets
 * (no route to the internet). Credentials are generated into Secrets Manager; nothing secret is
 * ever in code, CloudFormation parameters, or task definitions.
 *
 * Cost (⏱ hourly): db.t4g.micro ≈ $13/month + 20 GB gp3 ≈ $2.6/month + secret $0.40/month.
 */
export class DataStack extends Stack {
  readonly database: rds.DatabaseInstance;
  readonly secret: secretsmanager.ISecret;
  readonly securityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    const { config, vpc } = props;

    this.securityGroup = new ec2.SecurityGroup(this, 'DbSg', {
      vpc,
      description: 'PostgreSQL - inbound only from app/migration task security groups',
      allowAllOutbound: false,
    });

    this.database = new rds.DatabaseInstance(this, 'Postgres', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_17 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [this.securityGroup],
      publiclyAccessible: false,
      multiAz: false, // ~2x cost; enable for production SLAs
      databaseName: 'vlp',
      credentials: rds.Credentials.fromGeneratedSecret('vlp_admin', {
        secretName: `${config.appName}/db/admin`,
      }),
      allocatedStorage: 20,
      maxAllocatedStorage: 50, // storage autoscaling ceiling
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      caCertificate: rds.CaCertificate.RDS_CA_RSA2048_G1,
      // PostgreSQL 15+ on RDS enforces TLS by default (rds.force_ssl = 1).
      autoMinorVersionUpgrade: true,
      backupRetention: Duration.days(7),
      preferredBackupWindow: '20:00-20:30', // 01:30 IST
      preferredMaintenanceWindow: 'sun:21:00-sun:21:30',
      deletionProtection: true,
      removalPolicy: RemovalPolicy.SNAPSHOT, // final snapshot if the stack is ever deleted
    });
    this.secret = this.database.secret!;

    new CfnOutput(this, 'DbEndpoint', { value: this.database.dbInstanceEndpointAddress });
    new CfnOutput(this, 'DbSecretArn', { value: this.secret.secretArn });

    Validations.of(this).acknowledge(
      {
        id: 'AwsSolutions-RDS3',
        reason: 'Single-AZ to keep cost low for the MVP; Multi-AZ doubles the instance price.',
      },
      {
        id: 'AwsSolutions-RDS11',
        reason: 'Default port is fine: the DB is in isolated subnets and only reachable via SG.',
      },
      {
        id: 'AwsSolutions-SMG4',
        reason:
          'Rotation needs a Lambda with Secrets Manager access from the isolated subnets ' +
          '(interface endpoint ≈ $7/month/AZ). Planned before real users.',
      },
      {
        id: 'AwsSolutions-RDS6',
        reason: 'IAM database auth not needed; credentials come from Secrets Manager.',
      },
    );
  }
}
