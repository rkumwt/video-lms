import { Stack, Validations, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { type Construct } from 'constructs';

import { type VlpConfig } from './config';

export interface NetworkStackProps extends StackProps {
  config: VlpConfig;
}

/**
 * Cost-optimised VPC: **no NAT Gateway**.
 *
 * - `public` subnets: ALB + Fargate tasks (tasks get a public IP but their security group only
 *   accepts traffic from the ALB). This is how tasks reach ECR, CloudWatch, SQS, Secrets Manager.
 * - `isolated` subnets: no internet route at all. RDS goes here in Phase 5.
 * - S3 gateway endpoint: free, keeps S3 traffic (video uploads/reads) off the internet path.
 *
 * Trade-off: tasks in public subnets are less defence-in-depth than private subnets + NAT,
 * but a NAT Gateway costs ~$33/month per AZ before data, and interface endpoints ~$7/month each
 * per AZ. Switch later by moving tasks to PRIVATE_WITH_EGRESS and setting natGateways: 1.
 */
export class NetworkStack extends Stack {
  readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.20.0.0/16'),
      availabilityZones: props.config.availabilityZones,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
      gatewayEndpoints: {
        S3: { service: ec2.GatewayVpcEndpointAwsService.S3 },
      },
    });

    Validations.of(this.vpc).acknowledge({
      id: 'AwsSolutions-VPC7',
      reason: 'VPC flow logs add CloudWatch ingestion cost; enable when moving past MVP.',
    });
  }
}
