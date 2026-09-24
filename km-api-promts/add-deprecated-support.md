# Task: Add First-Class `deprecated` Support to km-api

## Repository and scope

Work only in the separate `km-api` repository.

Do not modify the `zopia` repository.

The previous km-api development branch was:

```text
arena/01a0cfb5-km-api
```

Use the current task branch for this work. Do not create or switch to an unrelated branch.

The package currently has a `disable` field:

```ts
disable: 'YES' | 'NO'
```

This task adds independent support for a new `deprecated` field.

---

## Important semantic distinction

`deprecated` and `disable` are different concepts and must never be automatically mapped to each other.

### `deprecated`

Indicates that an endpoint still exists and may still be used, but should no longer be preferred and may be removed in the future.

Type:

```ts
deprecated?: 'YES' | 'NO'
```

### `disable`

Indicates endpoint availability or application policy, such as:

- Disabled endpoint.
- Coming-soon endpoint.
- Temporarily unavailable endpoint.
- Application-controlled endpoint status.

Type:

```ts
disable?: 'YES' | 'NO'
```

The implementation must preserve this distinction.

Do not convert:

```ts
deprecated: 'YES'
```

into:

```ts
disable: 'YES'
```

Do not infer either field from the other.

All of the following combinations must remain valid and independent:

```ts
{
  disable: 'YES',
  deprecated: 'NO',
}
```

```ts
{
  disable: 'NO',
  deprecated: 'YES',
}
```

```ts
{
  disable: 'YES',
  deprecated: 'YES',
}
```

---

## Technical constraints

Preserve the existing project requirements:

- Zod v4.
- TypeScript.
- Bun.
- Vitest.
- JSDoc.
- Existing `makeApiConfig()` behavior.
- Existing public exports.
- Existing `disable` behavior.
- Existing runtime helper behavior.
- Existing package compatibility.
- Existing declaration/build output.
- Existing package release conventions.

Do not introduce unrelated features.

Do not add a Git submodule.

Do not modify or publish `zopia`.

---

# Required implementation

## 1. Add a deprecated schema

Add a reusable Zod schema for the new field, following the project’s existing naming and export conventions.

Preferred implementation:

```ts
export const deprecatedSchema = z.enum(['YES', 'NO']);
```

The schema must accept:

```ts
'YES'
'NO'
```

The schema must reject:

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

If the project uses a different naming convention for exported schemas, follow that convention consistently.

---

## 2. Extend the API configuration type

Update the type accepted by `makeApiConfig()` so this configuration is valid:

```ts
const api = makeApiConfig({
  method: 'GET',
  pathShape: '/users',
  deprecated: 'YES',
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
```

The field must be optional:

```ts
deprecated?: 'YES' | 'NO';
```

Existing configurations without `deprecated` must continue to compile and behave exactly as before.

---

## 3. Preserve `disable` independently

Do not remove, rename, or change the meaning of `disable`.

The following must remain valid:

```ts
const disabled = makeApiConfig({
  method: 'GET',
  pathShape: '/disabled',
  disable: 'YES',
  deprecated: 'NO',
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
```

```ts
const deprecated = makeApiConfig({
  method: 'GET',
  pathShape: '/legacy',
  disable: 'NO',
  deprecated: 'YES',
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
```

Verify that:

- `disable: 'YES'` remains distinct from `deprecated: 'YES'`.
- `disable: 'NO'` remains distinct from `deprecated: 'NO'`.
- Neither field changes the other.
- Existing `disableStatusSchema` behavior remains unchanged.

---

## 4. Preserve the value at runtime

If `makeApiConfig()` returns, clones, or normalizes the configuration, ensure that `deprecated` survives unchanged.

Example:

```ts
const config = makeApiConfig({
  method: 'GET',
  pathShape: '/users',
  deprecated: 'YES',
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
```

Also verify:

```ts
const config = makeApiConfig({
  method: 'GET',
  pathShape: '/users',
  deprecated: 'NO',
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

expect(config.deprecated).toBe('NO');
```

---

## 5. Export the schema publicly

If existing schemas are exported publicly, such as:

```ts
authStatusSchema
disableStatusSchema
methodSchema
pathSchema
```

then export the new schema consistently:

```ts
import { deprecatedSchema } from 'km-api';
```

Ensure the export is available from the package’s public entry point and included in generated declarations and package output.

---

# Required tests

Use the project’s existing Vitest and Zod v4 testing style.

## Schema validation tests

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

## `makeApiConfig()` runtime tests

Add tests confirming:

1. `deprecated: 'YES'` is accepted.
2. `deprecated: 'NO'` is accepted.
3. The value is preserved at runtime.
4. Omitting `deprecated` remains valid.
5. `disable` and `deprecated` can be used together.
6. `disable: 'YES', deprecated: 'NO'` remains distinct.
7. `disable: 'NO', deprecated: 'YES'` remains distinct.
8. No automatic conversion occurs between the fields.

## Backward compatibility tests

Verify that existing configurations without `deprecated` still:

- Compile.
- Pass runtime validation.
- Preserve their existing output.
- Preserve existing `disable` behavior.

## Type and declaration tests

Verify that generated declarations contain:

```ts
deprecated?: 'YES' | 'NO';
```

Verify that the public schema export is included in the declaration output.

---

# Documentation requirements

Update all relevant documentation and JSDoc.

Document `deprecated` as:

> A status value (`'YES'` or `'NO'`) indicating that an endpoint is still available but should no longer be preferred and may be removed in the future.

Document `disable` separately as:

> An application-status flag indicating that an endpoint is disabled, unavailable, coming soon, or otherwise controlled by application policy.

Add an explicit explanation:

> `deprecated` describes API lifecycle status. `disable` describes endpoint availability or application policy. Setting one does not automatically set or change the other.

Update all relevant locations, including:

- README.
- API configuration documentation.
- Public schema/export documentation.
- `makeApiConfig()` JSDoc.
- Type declarations or API reference documentation.
- Examples.
- Unreleased changelog.

Include an example such as:

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
```

The documentation must make clear that this endpoint is deprecated but not disabled.

---

# Compatibility restrictions

Do not:

- Remove `disable`.
- Rename `disable`.
- Change the meaning of `disable`.
- Convert `deprecated` to `disable`.
- Convert `disable` to `deprecated`.
- Make `deprecated` required.
- Break existing `makeApiConfig()` calls.
- Upgrade Zod to another major version.
- Modify zopia.
- Add unrelated functionality.
- Introduce a Git submodule.
- Change existing response, request, authentication, or content-type behavior.

---

# Validation commands

Inspect `package.json` first and use the repository’s actual scripts.

Run all applicable project checks, including equivalents of:

```bash
bun install
bun run typecheck
bun test
bun run build
```

Also run:

```bash
git diff --check
npm audit --omit=dev
```

If the project uses different command names, use the correct existing commands from `package.json`.

Confirm that:

- All tests pass.
- TypeScript passes.
- Declaration generation passes.
- The public `deprecatedSchema` export exists.
- `deprecated?: boolean` exists in the public type.
- Runtime values are preserved.
- Existing `disable` behavior is unchanged.
- `deprecated` and `disable` remain independent.
- The package contents include the new schema and type.
- The working tree contains only intentional changes.

---

# Release requirements

Before publishing:

1. Confirm the correct version bump according to the repository’s release policy.
2. Add the Unreleased changelog entry before the version bump.
3. Build the package.
4. Verify package contents:

   ```bash
   npm pack --dry-run
   ```

5. Confirm the new schema and type are included in the public entry point.
6. Publish only if the repository’s normal release process requires publication.
7. Do not publish from the zopia repository.
8. Report whether the package was published.

---

# Final response requirements

The final response must include:

- Summary of the implementation.
- Files changed.
- New public API.
- The exact distinction between `deprecated` and `disable`.
- Tests added.
- Typecheck results.
- Build results.
- Audit results.
- Package version.
- Whether the package was published.
- Branch name.
- Commit hash.
- Any remaining limitations or follow-up work.
