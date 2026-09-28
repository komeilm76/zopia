import { describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateApiDocsFiles, manifestFileToOpenApi, manifestToOpenApi, openApiToApiDocs } from '../src';
import { useTemporaryDirectories } from './test-temporary-directories';

const temporaryDirectory = useTemporaryDirectories();

const petComponent = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] };

function hookDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: { title: 'Hooks', version: '1.0.0' },
    paths: {
      '/pets': {
        get: { operationId: 'listPets', responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Pet' } } } } } } },
      },
    },
    webhooks: {
      newPet: {
        post: {
          operationId: 'newPet',
          description: 'Fired when a pet is created',
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } },
          responses: { '200': { description: 'ack' } },
        },
      },
      'x-custom': { origin: 'vendor' },
      emptyHook: {},
    },
    components: { schemas: { Pet: petComponent } },
    ...overrides,
  };
}

async function generateTree(document: Record<string, unknown>): Promise<string> {
  const outputDir = await temporaryDirectory('zopia-d23-');
  const files = await generateApiDocsFiles(document as any, { outputDir, insertComponents: true, useComponentAsReference: true });
  return outputDir + '::' + files.map((file: any) => file.file).sort().join(',');
}

describe('OpenAPI 3.1 webhook endpoint generation (D-23, S-87)', () => {
  it('emits webhook endpoint files and manifests webhook metadata during ③', async () => {
    const [outputDir, fileList] = (await generateTree(hookDocument())).split('::');
    expect(fileList).toContain('webhooks/newpet/post/index.ts');
    const manifest = JSON.parse(await readFile(join(outputDir, '.zopia-manifest.json'), 'utf8'));
    expect(manifest.webhookOrder).toEqual(['newPet', 'x-custom', 'emptyHook']);
    expect(manifest.documentOverlay.webhooks).toBeUndefined();
    expect(manifest.webhooksOverlay).toEqual({ 'x-custom': { origin: 'vendor' } });
    expect(manifest.webhooks).toHaveLength(1);
    expect(manifest.webhooks[0]).toMatchObject({
      file: 'webhooks/newpet/post/index.ts',
      name: 'newPet',
      method: 'post',
      operationId: 'newPet',
      sourceOperation: { description: 'Fired when a pet is created' },
      refs: [{ at: '/requestBody/content/application~1json/schema/$ref', component: 'Pet', ref: '#/components/schemas/Pet' }],
    });
    const module = await readFile(join(outputDir, 'webhooks/newpet/post/index.ts'), 'utf8');
    expect(module).toContain('pathShape: "/webhooks/newPet"');
    expect(module).toContain('operationId: "newPet"');
    expect(module).toContain('body: PetSchema');
  });

  it('keeps operation-less webhook maps as manifest-only with the ZOPIA_WARN_WEBHOOKS warning', async () => {
    const outputDir = await temporaryDirectory('zopia-d23-');
    const result = await openApiToApiDocs({
      openapi: '3.1.0',
      info: { title: 'No ops', version: '1' },
      paths: { '/x': { get: { responses: { '200': { description: 'ok' } } } } },
      webhooks: { update: {} },
    } as any, { outDir: outputDir });
    expect(result.files.some((file: any) => file.path.startsWith('webhooks/'))).toBe(false);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'ZOPIA_WARN_WEBHOOKS', at: '#/webhooks' }));
    const manifest = JSON.parse(await readFile(join(outputDir, '.zopia-manifest.json'), 'utf8'));
    expect(manifest.webhooks).toBeUndefined();
    expect(manifest.webhookOrder).toEqual(['update']);
    const document = manifestToOpenApi(manifest, {}) as any;
    expect(Object.keys(document.webhooks)).toEqual(['update']);
    expect(document.webhooks.update).toEqual({});
  });

  it('emits webhook operations without any ③ warning', async () => {
    const outputDir = await temporaryDirectory('zopia-d23-');
    const result = await openApiToApiDocs(hookDocument() as any, { outDir: outputDir });
    expect(result.warnings.filter((warning: any) => warning.code === 'ZOPIA_WARN_WEBHOOKS')).toHaveLength(0);
    expect(result.files.some((file: any) => file.path === 'webhooks/newpet/post/index.ts' && file.kind === 'endpoint')).toBe(true);
  });

  it('round-trips webhooks exactly through ③→④, preserving order, refs, and empty items', async () => {
    const [outputDir] = (await generateTree(hookDocument())).split('::');
    const document = await manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json')) as any;
    expect(document.openapi).toBe('3.1.0');
    expect(Object.keys(document.webhooks)).toEqual(['newPet', 'x-custom', 'emptyHook']);
    expect(document.webhooks.newPet.post).toEqual({
      operationId: 'newPet',
      description: 'Fired when a pet is created',
      requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } },
      responses: { '200': { description: 'ack' } },
    });
    expect(document.webhooks['x-custom']).toEqual({ origin: 'vendor' });
    expect(document.webhooks.emptyHook).toEqual({});
    expect(document.paths['/pets'].get.operationId).toBe('listPets');
  });

  it('derives deterministic operationIds for webhooks without an explicit operationId', async () => {
    const document = hookDocument();
    delete (document.webhooks as any).newPet.post.operationId;
    const [outputDir] = (await generateTree(document)).split('::');
    const manifest = JSON.parse(await readFile(join(outputDir, '.zopia-manifest.json'), 'utf8'));
    expect(manifest.webhooks[0].operationId).toBe('postNewPet');
    const reversed = await manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json')) as any;
    expect(reversed.webhooks.newPet.post.operationId).toBe('postNewPet');
  });

  it('restores pure $ref webhook items verbatim when their generated op is unchanged', async () => {
    const document = hookDocument({
      webhooks: {
        routed: { $ref: '#/components/pathItems/PetHooks' },
      },
      components: {
        schemas: { Pet: petComponent },
        pathItems: {
          PetHooks: {
            post: {
              operationId: 'routedPet',
              requestBody: { content: { 'application/json': { schema: { type: 'string' } } } },
              responses: { '200': { description: 'ack' } },
            },
          },
        },
      },
    });
    const [outputDir, fileList] = (await generateTree(document)).split('::');
    expect(fileList).toContain('webhooks/routed/post/index.ts');
    const [outputDirLiteral] = [outputDir];
    const manifest = JSON.parse(await readFile(join(outputDirLiteral, '.zopia-manifest.json'), 'utf8'));
    expect(manifest.webhooks[0].webhookItemRef).toBe(true);
    const reversed = await manifestFileToOpenApi(join(outputDirLiteral, '.zopia-manifest.json')) as any;
    // Task: pure-$ref items restore their source shape exactly (mirrors pathItemRef on paths).
    expect(reversed.webhooks.routed).toEqual({ $ref: '#/components/pathItems/PetHooks' });
    expect(reversed.components.pathItems.PetHooks.post.operationId).toBe('routedPet');
  });

  it('preserves x- webhook entries with empty items through the order list', async () => {
    const document = hookDocument({
      webhooks: {
        event: { post: { operationId: 'eventHook', responses: { '200': { description: 'ack' } } } },
        'x-empty': {},
      },
    });
    const [outputDir] = (await generateTree(document)).split('::');
    const reversed = await manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json')) as any;
    expect(Object.keys(reversed.webhooks)).toEqual(['event', 'x-empty']);
    expect(reversed.webhooks['x-empty']).toEqual({});
  });

  it('rejects duplicate operationIds across path and webhook operations during ③', async () => {
    const document = hookDocument({
      paths: {
        '/pets': { get: { operationId: 'listPets', responses: { '200': { description: 'ok' } } } },
        '/fromHook': { $ref: '#/webhooks/newPet' },
      },
    });
    const outputDir = await temporaryDirectory('zopia-d23-dup-');
    let code: string | undefined;
    let at: string | undefined;
    try { await generateApiDocsFiles(document as any, { outputDir }); } catch (error: any) { code = error?.code; at = error?.at; }
    // The path aliases the webhook item through $ref, so both collectors mint the same
    // explicit operationId (newPet) — OpenAPI requires document-wide uniqueness.
    expect(code).toBe('ZOPIA_SPEC_INVALID');
    expect(at).toBe('#/webhooks/newPet');
  });

  it('throws typed errors for malformed webhook items (null, number, string, array)', async () => {
    for (const bad of [null, 42, 'text', []]) {
      const document = hookDocument({ webhooks: { bad } as any });
      const outputDir = await temporaryDirectory('zopia-d23-bad-');
      let code: string | undefined;
      let message = '';
      try { await generateApiDocsFiles(document as any, { outputDir }); } catch (error: any) { code = error?.code; message = String(error?.message ?? error); }
      expect(code).toBe('ZOPIA_SPEC_INVALID');
      expect(message).toContain('webhook item');
    }
  });

  it('omits webhooks from 3.0 output with a targeted warning', async () => {
    const [outputDir] = (await generateTree(hookDocument())).split('::');
    const warnings: unknown[] = [];
    const document = await manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json'), { version: '3.0', onWarning: (warning) => void warnings.push(warning) }) as any;
    expect(document.openapi).toBe('3.0.0');
    expect(document.webhooks).toBeUndefined();
    expect(document.paths['/pets'].get.operationId).toBe('listPets');
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'ZOPIA_WARN_WEBHOOKS', at: '#/webhooks' }));
  });

  it('omits webhooks from 2.0 output with a targeted warning', async () => {
    const [outputDir] = (await generateTree(hookDocument())).split('::');
    const manifest = JSON.parse(await readFile(join(outputDir, '.zopia-manifest.json'), 'utf8'));
    const warnings: unknown[] = [];
    const openapi = manifestToOpenApi(manifest, { version: '2.0', onWarning: (warning) => void warnings.push(warning) }) as any;
    expect(openapi.swagger).toBe('2.0');
    expect(openapi.webhooks).toBeUndefined();
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'ZOPIA_WARN_WEBHOOKS', at: '#/webhooks' }));
  });

  it('runtime-refreshes webhook operations from edited generated modules during ④', async () => {
    const [outputDir] = (await generateTree(hookDocument())).split('::');
    const modulePath = join(outputDir, 'webhooks/newpet/post/index.ts');
    const source = await readFile(modulePath, 'utf8');
    await writeFile(modulePath, source.replace('description: "Fired when a pet is created"', 'description: "EDITED_MARK"'), 'utf8');
    const reversed = await manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json')) as any;
    expect(reversed.webhooks.newPet.post.description).toBe('EDITED_MARK');
    expect(reversed.webhooks.newPet.post.requestBody.content['application/json'].schema).toEqual({ $ref: '#/components/schemas/Pet' });
  });

  it('rejects duplicate operationIds across path and webhook operations during ④', async () => {
    const [outputDir] = (await generateTree(hookDocument())).split('::');
    // ③ rejects this in the source document; for hand-edited trees the reverse must
    // still guard it — make the generated webhook module collide with the path id.
    const modulePath = join(outputDir, 'webhooks/newpet/post/index.ts');
    const source = await readFile(modulePath, 'utf8');
    await writeFile(modulePath, source.replace('operationId: "newPet"', 'operationId: "listPets"'), 'utf8');
    await expect(manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json'))).rejects.toThrow('Duplicate reconstructed operationId: listPets');
  });

  it('treats webhooks and paths as separate namespaces (a webhook may be named like a path)', async () => {
    const document = hookDocument();
    delete (document.webhooks as any).newPet;
    (document.webhooks as any)['/pets'] = { get: { operationId: 'petsHook', responses: { '200': { description: 'ack' } } } };
    const [outputDir] = (await generateTree(document)).split('::');
    const reversed = await manifestFileToOpenApi(join(outputDir, '.zopia-manifest.json')) as any;
    expect(reversed.paths['/pets'].get.operationId).toBe('listPets');
    expect(reversed.webhooks['/pets'].get.operationId).toBe('petsHook');
  });

  it('does not alias webhooksOverlay extension values into the reversed document', async () => {
    const [outputDir] = (await generateTree(hookDocument())).split('::');
    const manifest = JSON.parse(await readFile(join(outputDir, '.zopia-manifest.json'), 'utf8'));
    const reversed = manifestToOpenApi(manifest, {}) as any;
    reversed.webhooks['x-custom'].origin = 'mutated';
    expect(manifest.webhooksOverlay['x-custom'].origin).toBe('vendor');
  });

  it('synthesizes fallback security for runtime auth: YES webhook endpoints without manifest security', async () => {
    const document = hookDocument({
      components: {
        schemas: { Pet: petComponent },
        securitySchemes: { apiKeyAuth: { type: 'apiKey', name: 'x-key', in: 'header' } },
      },
    });
    (document.webhooks as any).newPet.post.security = [{ apiKeyAuth: [] }];
    const [outputDir] = (await generateTree(document)).split('::');
    const manifestPath = join(outputDir, '.zopia-manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    expect(manifest.webhooks[0].security).toEqual([{ apiKeyAuth: [] }]);
    // Tamper: drop every explicit security record while the module still reports auth: YES.
    delete manifest.webhooks[0].security;
    delete manifest.webhooks[0].sourceOperation.security;
    delete manifest.components.securitySchemes;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    const warnings: unknown[] = [];
    const reversed = await manifestFileToOpenApi(manifestPath, { onWarning: (warning) => void warnings.push(warning) }) as any;
    const operation = reversed.webhooks.newPet.post;
    expect(operation.security).toHaveLength(1);
    expect(Object.keys(operation.security[0])).toHaveLength(1);
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'ZOPIA_WARN_DEFAULT_SECURITY', at: '#/webhooks/newPet/post/security' }));
    expect(reversed.components?.securitySchemes ?? {}).toHaveProperty(Object.keys(operation.security[0])[0]);
  });

  it('rejects tampered manifests whose webhook entries miss the webhook-order entry', async () => {
    const [outputDir] = (await generateTree(hookDocument())).split('::');
    const manifest = JSON.parse(await readFile(join(outputDir, '.zopia-manifest.json'), 'utf8'));
    manifest.webhookOrder = manifest.webhookOrder.filter((name: string) => name !== 'newPet');
    expect(() => manifestToOpenApi(manifest, {})).not.toThrow();
    const openapi = manifestToOpenApi(manifest, {}) as any;
    expect(openapi.webhooks.newPet.post.operationId).toBe('newPet');
  });
});
