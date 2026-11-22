/* eslint-disable no-console -- CLI script */
/**
 * Development seed: sample videos so the UI has something to show.
 * Run: pnpm db:seed (refuses to run with NODE_ENV=production).
 */
import { createDb } from '../src/index';

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to seed a production database');
}

const db = createDb();

const titles = [
  'Getting started with the platform',
  'Recording your screen with camera overlay',
  'Prisma migrations: expand and contract',
  'Deploying to AWS with CDK',
  'Debugging an OIDC trust policy',
  'Keyset pagination explained',
  'TLS to RDS: the single-CA gotcha',
  'Why we chose Fargate Spot for the worker',
];

const statuses = [
  'READY',
  'READY',
  'READY',
  'PROCESSING',
  'READY',
  'UPLOADED',
  'READY',
  'FAILED',
] as const;

async function main() {
  await db.video.deleteMany({ where: { storageKey: { startsWith: 'seed/' } } });
  const now = Date.now();
  await db.video.createMany({
    data: titles.map((title, i) => ({
      title,
      description: i % 2 === 0 ? `Sample description for “${title}”.` : null,
      recordingType: i % 3 === 0 ? 'SCREEN_CAMERA' : 'SCREEN',
      storageType: i % 4 === 0 ? 'LOCAL' : 'S3',
      storageKey: `seed/${i}.webm`,
      durationSec: 45 + i * 97,
      sizeBytes: BigInt(Math.round((8 + i * 37.5) * 1024 * 1024)),
      mimeType: 'video/webm',
      status: statuses[i]!,
      createdAt: new Date(now - i * 7.5 * 3600 * 1000),
    })),
  });
  console.log(`Seeded ${titles.length} videos`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
