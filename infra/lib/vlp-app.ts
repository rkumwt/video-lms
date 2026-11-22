import { type App, Tags, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';

import { AppStack } from './app-stack';
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

  const appStack = new AppStack(app, 'Vlp-App', {
    env,
    config,
    vpc: network.vpc,
    apiRepo: foundation.apiRepo,
    workerRepo: foundation.workerRepo,
    videosBucket: foundation.videosBucket,
    alertsTopic: foundation.alertsTopic,
  });

  // Cost allocation + ownership tags on every resource.
  Tags.of(app).add('Project', 'learning-video-platform');
  Tags.of(app).add('ManagedBy', 'cdk');

  // Security/best-practice checks at synth time; violations fail `cdk synth`.
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));

  return { network, foundation, appStack };
}
