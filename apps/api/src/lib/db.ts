import { createDb, type Db } from '@vlp/db';

let client: Db | undefined;

/** Lazily created so the app (and tests) can boot without a database. */
export function getDb(): Db {
  client ??= createDb();
  return client;
}

export async function disconnectDb(): Promise<void> {
  await client?.$disconnect();
  client = undefined;
}
