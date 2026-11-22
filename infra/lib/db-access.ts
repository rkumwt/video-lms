import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

/** Path of the RDS CA bundle baked into the api/worker images (see apps/api/Dockerfile). */
export const RDS_CA_BUNDLE_PATH = '/etc/ssl/certs/rds-global-bundle.pem';

/**
 * Container secrets for database access. ECS reads each JSON key from the generated RDS secret at
 * task start, so the password never appears in a task definition or the CloudFormation template.
 */
export function dbSecrets(secret: secretsmanager.ISecret): Record<string, ecs.Secret> {
  const key = (field: string) => ecs.Secret.fromSecretsManager(secret, field);
  return {
    DB_HOST: key('host'),
    DB_PORT: key('port'),
    DB_NAME: key('dbname'),
    DB_USER: key('username'),
    DB_PASSWORD: key('password'),
  };
}

/** Non-secret DB settings: verify TLS against the RDS CA bundle. */
export const dbEnvironment = { DB_SSL_CA: RDS_CA_BUNDLE_PATH };

/**
 * Allows `client` to reach PostgreSQL. `remoteRule: true` creates the ingress rule in the CLIENT's
 * stack, so the Data stack never depends on (and can't deadlock with) its consumers.
 */
export function allowDbAccess(
  dbSecurityGroup: ec2.ISecurityGroup,
  client: ec2.ISecurityGroup,
  description: string,
): void {
  dbSecurityGroup.addIngressRule(client, ec2.Port.tcp(5432), description, true);
}
