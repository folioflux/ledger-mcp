// Regenerates src/generated.ts from transaction.schema.json.
// Usage: node scripts/generate.mjs [--check]
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';

const root = fileURLToPath(new URL('..', import.meta.url));
const schemaPath = `${root}transaction.schema.json`;
const outPath = `${root}src/generated.ts`;
const check = process.argv.includes('--check');

const schema = JSON.parse(await readFile(schemaPath, 'utf8'));

const types = await compile(structuredClone(schema), 'Transaction', {
  bannerComment: '',
  additionalProperties: false,
  strictIndexSignatures: true,
  style: { singleQuote: true, printWidth: 100, trailingComma: 'all' },
});

const output = [
  '/* eslint-disable */',
  '// This file is generated from transaction.schema.json by scripts/generate.mjs.',
  '// Do not edit it by hand: change the schema and run `pnpm --filter @folioflux/transaction-schema generate`.',
  '',
  types.trimEnd(),
  '',
  '/** The transaction JSON Schema (draft 2020-12) as a plain object. */',
  `export const transactionSchema = ${JSON.stringify(schema, null, 2)} as const;`,
  '',
].join('\n');

if (check) {
  let current = '';
  try {
    current = await readFile(outPath, 'utf8');
  } catch {
    // Missing file is reported below.
  }
  if (current !== output) {
    console.error(
      'src/generated.ts is out of date. Run `pnpm --filter @folioflux/transaction-schema generate`.',
    );
    process.exit(1);
  }
} else {
  await writeFile(outPath, output);
  console.error('Wrote src/generated.ts');
}
