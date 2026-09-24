# Add `deprecated` Support to km-api

Implement a new optional `deprecated` field in `km-api`.

## Semantics

`deprecated` and `disable` are separate fields:

- `deprecated` describes API lifecycle status. It means the endpoint still exists but should no longer be preferred.
- `disable` describes endpoint availability or application policy, such as disabled or coming-soon endpoints.

Never convert one field into the other. In particular:

```ts
deprecated: 'YES'
```

must not automatically become:

```ts
disable: 'YES'
```

Both fields may be used independently:

```ts
{
  deprecated: 'YES',
  disable: 'NO',
}
```

## Implementation

Add a reusable public schema:

```ts
export const deprecatedSchema = z.enum(['YES', 'NO']);
```

Extend the API configuration type accepted by `makeApiConfig()`:

```ts
deprecated?: 'YES' | 'NO';
```

The field must be optional so existing configurations remain valid.

The value must be preserved at runtime without normalization into `disable`:

```ts
const config = makeApiConfig({
  method: 'GET',
  pathShape: '/legacy-users',
  deprecated: 'YES',
  disable: 'NO',
  request: {
    body: z.any(),
    params: z.object({}),
    query: z.object({}),
    headers: z.object({}),
    cookies: z.object({}),
  },
  response: {
    200: z.object({}),
  },
});

expect(config.deprecated).toBe('YES');
expect(config.disable).toBe('NO');
```

Preserve the existing `disable` field and `disableStatusSchema` behavior unchanged.

Export `deprecatedSchema` from the package’s public entry point and include it in generated declarations.

## Tests

Add tests confirming that `deprecatedSchema` accepts:

```ts
'YES'
'NO'
```

and rejects:

```ts
true
false
0
1
null
undefined
{}
[]
```

Add `makeApiConfig()` tests confirming:

1. `deprecated: 'YES'` is accepted and preserved.
2. `deprecated: 'NO'` is accepted and preserved.
3. Omitting `deprecated` remains valid.
4. `disable` and `deprecated` can be used together.
5. `disable: 'YES'` does not change `deprecated`.
6. `deprecated: 'YES'` does not change `disable`.
7. No automatic conversion occurs between the two fields.
8. Existing configurations continue to work unchanged.

Verify the generated type declarations contain:

```ts
deprecated?: 'YES' | 'NO';
```

## Documentation

Update the relevant README, API configuration documentation, JSDoc, public API documentation, and changelog.

Document the distinction clearly:

> `deprecated` describes API lifecycle status. `disable` describes endpoint availability or application policy. Setting one does not automatically set or change the other.

Include an example showing an endpoint with:

```ts
deprecated: 'YES',
disable: 'NO',
```

## Validation

Inspect the repository’s existing scripts and run the appropriate checks, including:

```bash
bun install
bun run typecheck
bun test
bun run build
npm audit --omit=dev
git diff --check
```

Also verify the package contents with:

```bash
npm pack --dry-run
```

Do not introduce unrelated changes. Before finishing, report the files changed, tests run, build results, package version, commit hash, branch, and whether the package was published.
