---
layout: home
title: zopia
titleTemplate: Type-safe OpenAPI ↔ Zod toolkit
description: Turn swagger.json into type-safe, runnable endpoint code — and turn that code back into a spec.

hero:
  name: zopia
  text: Your OpenAPI spec, as type-safe code
  tagline: Generate runnable, validated endpoint modules from Swagger 2.0 and OpenAPI 3.x — then regenerate the spec from the code. Nothing is ever lost.
  actions:
    - theme: brand
      text: Get started
      link: /guide/quick-start
    - theme: alt
      text: Installation
      link: /guide/installation
    - theme: alt
      text: View on GitHub
      link: https://github.com/komeilm76/zopia

features:
  - icon: 🔄
    title: Four conversion engines
    details: Zod → JSON Schema, JSON Schema → Zod, OpenAPI → api docs, and api docs → OpenAPI. Every direction is a first-class, tested contract.
    link: /reference/conversions
    linkText: Mapping rules
  - icon: 📖
    title: Swagger 2.0 and OpenAPI 3.x
    details: Both dialects normalize into one internal model, so v2 and v3 sources produce identical, predictable output.
    link: /reference/conversions
    linkText: Dialect handling
  - icon: 🔒
    title: Lossless round-trips
    details: A manifest keeps every generated tree reversible. openapi → code → openapi converges — re-running the pipeline on its own output is a no-op.
    link: /reference/api-docs-format
    linkText: The manifest
  - icon: ⌨️
    title: A CLI that fits CI
    details: generate, reverse, validate, diff, navigate, and --watch. Strict parsing, deterministic output, documented exit codes.
    link: /guide/cli
    linkText: CLI reference
  - icon: 🧱
    title: $ref graphs, handled
    details: Nested component references, mutual cycles, and reusable parameters resolve into clean imports — lazily where they must.
    link: /reference/components
    linkText: Components
  - icon: 🌳
    title: Load the whole tree
    details: createApiDocs() turns a generated directory into one exactly-typed object, so endpoints can be wired dynamically.
    link: /guide/runtime
    linkText: Runtime
  - icon: ⚠️
    title: No silent losses
    details: Every approximation emits a stable, located warning code. Every failure is a typed error with a hint. Both are documented.
    link: /reference/errors-and-warnings
    linkText: Every code
  - icon: 📦
    title: Zero runtime dependencies
    details: Only zod and km-api as peers. Generated code never imports zopia, so your application bundle stays yours.
    link: /guide/installation
    linkText: Install
---

<div class="zopia-section">

## Install

::: code-group

```bash [bun]
bun add zopia
bun add zod km-api
```

```bash [npm]
npm install zopia
npm install zod km-api
```

```bash [pnpm]
pnpm add zopia
pnpm add zod km-api
```

```bash [yarn]
yarn add zopia
yarn add zod km-api
```

:::

## From spec to type-safe code

One command turns a document your team already maintains into endpoint modules
you can import today.

```bash
bunx zopia generate openapi.json api_docs --insert-components --use-component-as-reference
```

```text
api_docs/
├── .zopia-manifest.json
├── components/
│   ├── index.ts
│   ├── CreateUser/index.ts
│   └── User/index.ts
├── health/get/index.ts
└── users/{userId}/
    ├── get/index.ts
    └── patch/index.ts
```

```ts
import getUser from './api_docs/users/{userId}/get/index';

const url = getUser.makeFullPath({ userId: '550e8400-e29b-41d4-a716-446655440000' });
const body = getUser.makeBody(undefined); // type-safe: GET has no body
```

And back again, whenever you need the document:

```bash
bunx zopia reverse api_docs --out openapi.json
```

## Works with

**TypeScript 5.9+** · **Zod 4.x** · **km-api 0.4.x** · **Bun 1.x** · **Node 20+**

</div>
