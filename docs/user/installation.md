# 📦 Installation

How to add zopia to a project, which peer dependencies it needs, and what the
supported runtimes are.

## ⚙️ Requirements

| 🧰 Requirement | 🏷️ Version | 📝 Why |
| --- | --- | --- |
| Node.js | `>= 20` | runtime floor declared by the package `engines` field |
| Bun | `>= 1.1` (dev: `1.2.21` pinned) | zopia is Bun-first; the CLI shebang and the release gate run on Bun |
| TypeScript | `>= 5.9` recommended | zopia publishes **TypeScript sources** — your toolchain compiles them |
| `zod` | `^4.0.0` (peer) | engines ①/② convert runtime schemas; generated files validate with Zod |
| `km-api` | `^0.4.1` (peer) | generated endpoint files call `makeApiConfig()`; engine ④ imports their results |

> 📌 zopia has **zero direct runtime dependencies**. Everything it needs comes
> from the two peers above, which you install yourself so there is exactly one
> copy of each in your project.

## 📥 Install

**Bun** (recommended)

```bash
bun add zopia
bun add zod km-api
```

**npm**

```bash
npm install zopia
npm install zod km-api
```

**pnpm**

```bash
pnpm add zopia
pnpm add zod km-api
```

**yarn**

```bash
yarn add zopia
yarn add zod km-api
```

| 📦 Package | 🏷️ Kind | 📝 Why you need it |
| --- | --- | --- |
| `zopia` | dependency (often `devDependency`) | the four conversion engines and the CLI |
| `zod` `^4` | peer dependency | the schema language zopia reads and writes |
| `km-api` `^0.4.1` | peer dependency | the endpoint-config factory the generated tree uses |

> 💡 **Dev-only install** — if you only ever run `zopia generate` in CI or as a
> script and ship the generated tree, `zopia` belongs in `devDependencies`.
> `zod` and `km-api` stay **runtime** dependencies because the generated code
> imports them.

## 🏃 Run the CLI without installing

```bash
bunx zopia --help
npx  zopia --help
```

## 🧩 TypeScript setup

zopia publishes `.ts` sources and resolves through the `exports` map, so your
`tsconfig.json` must use a modern bundler/node resolution:

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ES2022",
    "strict": true,
    "allowImportingTsExtensions": false
  }
}
```

| 🔌 Entry point | 📝 What it gives you |
| --- | --- |
| `zopia` | the engines, config helpers, validation, diff, errors, warnings |
| `zopia/runtime` | `createApiDocs()` / `flattenApiDocs()` — the only filesystem-importing API, kept out of the root on purpose |

```ts
import { openApiToApiDocs } from 'zopia';
import { createApiDocs } from 'zopia/runtime';
```

## ✅ Verify the installation

```bash
bunx zopia --help          # prints the full command grammar
```

```ts
import { zodToJsonSchema } from 'zopia';
import { z } from 'zod';

console.log(zodToJsonSchema(z.object({ ok: z.boolean() })));
// → { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], … }
```

## 🔗 Next

- ⚡ [Quick start](quick-start.md) — your first generated tree
- ⌨️ [CLI reference](cli.md) — every command and flag
- ⚙️ [Configuration](configuration.md) — `zopia.config.ts` and every option
