# 🧑‍💻 Zopia Navigator (VS Code extension)

Jump between a Swagger/OpenAPI document and the zopia-generated api-docs tree
in **both directions**. All mapping logic lives in zopia's navigation core
(`loadNavigationIndex`, `specToLocations`, `treeToSpecLocation`,
`specPointersToLines`, `specPointerAtLine`, `pointerForOperationId`) — this
extension is thin glue that resolves the workspace, opens documents, and
shows errors, so it cannot drift from the manifest contract your tree uses.

## Commands

| 🧩 Command | ▶️ Behavior |
| --- | --- |
| `Zopia: Open generated code` | Run from a `.json`/`.yaml` spec — resolves the operation/schema at-or-above the cursor and opens its generated module (endpoint, webhook, or component). Pick the tree when several manifest roots exist. |
| `Zopia: Open spec location` | Run from any generated file (endpoint, webhook, component, `custom.ts` companion, even `.zopia-manifest.json`) — opens the spec document at the owning pointer's declaration line. |

Both commands are in the Command Palette (`Ctrl+Shift+P`) and the editor
context menu: `.ts` files inside a tree for *Open spec location*, and
`.json`/`.yaml` specs for *Open generated code*.

## Installation

1. `npm install zopia` in the workspace that owns the tree — the extension
   resolves *that* copy, so it always matches the manifest shape on disk.
2. Package/install this extension:
   - **Development** — open `editors/vscode/`in VS Code, press `F5` for an
     extension-host window.
   - **Local install** — `npx @vscode/vsce package` here, then
     `code --install-extension zopia-vscode-navigator-<version>.vsix`.

## Behavior notes

- **Manifest-driven**: preset bucket roots (`.zopia-manifest.json` inside
  sub-trees) work identically — navigation always anchors to the *nearest*
  manifest above the edited file.
- **JSON specs jump exactly**: the declaration line comes from zopia's
  single-pass pointer scanner. **YAML specs** line-jump via the nearest
  `operationId:` marker at-or-above the target (documented best-effort —
  exact structural scanning of YAML is intentionally not duplicated in glue).
- **No build step**: plain CommonJS (`extension.js`), no bundler required.

## Testing

The mapping guarantees are covered by zopia's own test suite
(`tests/navigation.test.ts`, task S-93); this package contains no testable
logic beyond glue. For a smoke pass: install in an extension-host window,
`zopia generate petstore.json api_docs --custom`, then run both commands
from `petstore.json` and from `api_docs/pets/get/custom.ts`.
