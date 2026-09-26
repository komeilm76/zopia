import type { ZopiaGenerateOptions } from '../src';

/** Checked-in generated-tree variants governed by R-112/R-126. */
export const GOLDEN_CASES = [
  {
    name: 'admin-api-3.0.directory',
    fixture: 'admin-api-3.0.json',
    options: {},
  },
  {
    name: 'admin-api-3.0.flat',
    fixture: 'admin-api-3.0.json',
    options: { mode: 'flat' },
  },
  {
    name: 'admin-api-3.0.components',
    fixture: 'admin-api-3.0.json',
    options: { insertComponents: true, useComponentAsReference: true },
  },
  {
    name: 'km-api-0.4.1.contract',
    fixture: 'km-api-contract-3.1.json',
    options: {},
  },
] as const satisfies ReadonlyArray<{
  name: string;
  fixture: string;
  options: Omit<ZopiaGenerateOptions, 'outDir'>;
}>;
