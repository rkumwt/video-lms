import { type App, Tags, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';

import { AppStack } from './app-stack';
import { CiCdStack } from './cicd-stack';
import { DataStack } from './data-stack';
import { MigrateStack } from './migrate-stack';
import { type VlpConfig } from './config';
import { FoundationStack } from './foundation-stack';
import { NetworkStack } from './network-stack';

/** Wires all stacks together. Shared by `bin/app.ts` and the tests. */
export function buildVlpApp(app: App, config: VlpConfig) {
  const env = config.account
    ? { account: config.account, region: config.region }
    : { region: config.region };

  const network = new NetworkStack(app, 'Vlp-Network', { env, config });

  const foundation = new FoundationStack(app, 'Vlp-Foundation', {
    env,
    config,
    // Holds user videos: protect against an accidental `cdk destroy`.
    terminationProtection: true,
  });

  const data = new DataStack(app, 'Vlp-Data', {
    env,
    config,
    vpc: network.vpc,
    // Holds all application data: protect against an accidental `cdk destroy`.
    terminationProtection: true,
  });

  const migrate = new MigrateStack(app, 'Vlp-Migrate', {
    env,
    config,
    vpc: network.vpc,
    apiRepo: foundation.apiRepo,
    dbSecurityGroup: data.securityGroup,
    dbSecret: data.secret,
  });

  const appStack = new AppStack(app, 'Vlp-App', {
    env,
    config,
    vpc: network.vpc,
    apiRepo: foundation.apiRepo,
    workerRepo: foundation.workerRepo,
    videosBucket: foundation.videosBucket,
    videoEventsQueue: foundation.videoEventsQueue,
    alertsTopic: foundation.alertsTopic,
    dbSecurityGroup: data.securityGroup,
    dbSecret: data.secret,
  });

  // Deployed manually by an admin, never by the pipeline itself.
  const cicd = new CiCdStack(app, 'Vlp-CiCd', {
    env,
    config,
    apiRepo: foundation.apiRepo,
    workerRepo: foundation.workerRepo,
  });

  // Cost allocation + ownership tags on every resource.
  Tags.of(app).add('Project', 'learning-video-platform');
  Tags.of(app).add('ManagedBy', 'cdk');

  // Security/best-practice checks at synth time; violations fail `cdk synth`.
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));

  return { network, foundation, data, migrate, appStack, cicd };
}
