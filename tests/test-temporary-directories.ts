import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';

/** Register isolated temporary directories that are removed after every test. */
export function useTemporaryDirectories(defaultPrefix = 'zopia-'): (prefix?: string) => Promise<string> {
  const directories = new Set<string>();

  afterEach(async () => {
    const owned = [...directories];
    directories.clear();
    await Promise.all(owned.map((directory) => rm(directory, { recursive: true, force: true })));
  });

  return async (prefix = defaultPrefix): Promise<string> => {
    const directory = await mkdtemp(join(tmpdir(), prefix));
    directories.add(directory);
    return directory;
  };
}
