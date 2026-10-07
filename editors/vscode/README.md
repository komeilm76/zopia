# 🧑‍💻 Zopia Navigator (VS Code extension)

Jump between a Swagger/OpenAPI document and the zopia-generated api-docs tree
in **both directions**. The extension reads `.zopia-manifest.json` directly and
opens the matching generated modules or source declarations.

It is intentionally zero-build CommonJS glue for VS Code's Node-based extension
host. It does **not** dynamically import the workspace's `zopia` package, so it
keeps working even though the zopia package itself is Bun-first and publishes
TypeScript source.

## Commands

| 🧩 Command | ▶️ Behavior |
| --- | --- |
| `Zopia: Open generated code` | Run from a `.json`/`.yaml` spec — resolves the operation/component at-or-above a JSON cursor, or the containing operation around a YAML cursor, then opens its generated module (endpoint, webhook, schema component, reusable parameter, or reusable response). Pick the tree when several manifest roots exist. |
| `Zopia: Open spec location` | Run from any generated file (endpoint, webhook, component, reusable parameter/response module, `custom.ts` companion, even `.zopia-manifest.json`) — opens the spec document at the owning pointer's declaration line. |

Both commands are in the Command Palette (`Ctrl+Shift+P`) and the editor
context menu: `.ts` files inside a tree for *Open spec location*, and
`.json`/`.yaml` specs for *Open generated code*.

## Installation

1. Generate an api-docs tree in the workspace with zopia so a
   `.zopia-manifest.json` exists.
2. Package/install this extension:
   - **Development** — open `editors/vscode/` in VS Code, press `F5` for an
     extension-host window.
   - **Local install** — `npx @vscode/vsce package` here, then
     `code --install-extension zopia-vscode-navigator-<version>.vsix`.

## Behavior notes

- **Manifest-driven**: preset bucket roots (`.zopia-manifest.json` inside
  sub-trees) work identically — navigation always anchors to the *nearest*
  manifest above the edited file.
- **JSON specs jump exactly**: the declaration line comes from the extension's
  single-pass pointer scanner, mirroring zopia's navigation contract. **YAML
  specs** line-jump via the nearest simple `operationId:` marker whose YAML
  mapping still contains the cursor; plain, single-quoted, double-quoted, and
  commented scalar values are handled. Structural YAML component positions are
  left unanswered rather than guessed. Exact YAML scanning is intentionally
  not duplicated in glue.
- **Input formats mirror zopia**: `.json`, `.yaml`, and `.yml` are supported.
  JSON-with-comments (`.jsonc`) is not offered as a spec source because zopia's
  CLI/public readers do not accept it as a first-class spec format.
- **Spec discovery prefers files outside the generated tree**, but still finds a
  source document colocated with the manifest when `outDir` is the workspace
  root itself. Manifest source titles disambiguate multiple candidates.
- **No build step**: plain CommonJS (`extension.js`), no bundler required.

## Testing

The canonical mapping guarantees are covered by zopia's own test suite
(`tests/navigation.test.ts`, task S-93). For a smoke pass: install in an
extension-host window, run `zopia generate petstore.json api_docs --custom`,
then run both commands from `petstore.json` and from
`api_docs/pets/get/custom.ts`.
