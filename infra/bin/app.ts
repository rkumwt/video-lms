#!/usr/bin/env node
import { App } from 'aws-cdk-lib';

import { loadConfig } from '../lib/config';
import { buildVlpApp } from '../lib/vlp-app';

const app = new App();
buildVlpApp(app, loadConfig(app));
