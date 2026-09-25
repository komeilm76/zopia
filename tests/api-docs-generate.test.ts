import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateApiDocsFiles } from '../src';

describe('API docs endpoint generation', () => {
  it('generates component files and a sorted barrel', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    const files = await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, components: { schemas: { Zebra: true, Alpha: { type: 'object', properties: { name: { type: 'string' } } } } }, paths: {} }, { outputDir, insertComponents: true });
    expect(files.map((file) => file.file)).toEqual(['components/Alpha/index.ts', 'components/Zebra/index.ts', 'components/index.ts', '.zopia-manifest.json']);
    const barrel = await readFile(join(outputDir, 'components/index.ts'), 'utf8');
    expect(barrel).toContain('export { AlphaSchema } from "./Alpha/index";');
    expect(barrel).not.toContain('\\n');
    expect(await readFile(join(outputDir, 'components/Alpha/index.ts'), 'utf8')).not.toContain('\\n');
    const manifest = JSON.parse(await readFile(join(outputDir, '.zopia-manifest.json'), 'utf8'));
    expect(manifest.source.kind).toBe('openapi-3.1');
    expect(manifest.apis).toEqual([]);
    const reorderedDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ components: { schemas: { Zebra: true, Alpha: { type: 'object', properties: { name: { type: 'string' } } } } }, paths: {}, info: { version: '1', title: 'Test' }, openapi: '3.1.0' }, { outputDir: reorderedDir, insertComponents: true });
    expect(JSON.parse(await readFile(join(outputDir, '.zopia-manifest.json'), 'utf8')).source.sha256).toBe(JSON.parse(await readFile(join(reorderedDir, '.zopia-manifest.json'), 'utf8')).source.sha256);
    await expect(generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, components: { schemas: { 'A-B': { type: 'string' }, AB: { type: 'string' } } }, paths: {} }, { outputDir, insertComponents: true })).rejects.toThrow('Component export name collision');
  });
  it('preserves original component directory names in generated imports', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, components: { schemas: { User: { type: 'object' }, 'User Profile': { $ref: '#/components/schemas/User' } } }, paths: {} }, { outputDir, insertComponents: true });
    const content = await readFile(join(outputDir, 'components', 'User Profile', 'index.ts'), 'utf8');
    expect(content).toContain('from "../User/index"');
  });
  it('imports direct nested array component references', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, components: { schemas: { User: { type: 'object' }, Users: { type: 'array', items: { $ref: '#/components/schemas/User' } } } }, paths: {} }, { outputDir, insertComponents: true });
    const content = await readFile(join(outputDir, 'components', 'Users', 'index.ts'), 'utf8');
    expect(content).toContain('import { UserSchema } from "../User/index";');
    expect(content).toContain('z.array(UserSchema)');
  });
  it('renders deeply nested object references recursively', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, components: { schemas: { User: { type: 'object' }, Group: { type: 'object', properties: { profile: { type: 'object', properties: { users: { type: 'array', items: { $ref: '#/components/schemas/User' } } } } } } } }, paths: {} }, { outputDir, insertComponents: true });
    const content = await readFile(join(outputDir, 'components', 'Group', 'index.ts'), 'utf8');
    expect(content).toContain('z.array(UserSchema)');
    expect(content).toContain('z.object({ ["users"]: z.array(UserSchema).optional() }).passthrough()');
  });
  it('renders nested composition references', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, components: { schemas: { User: { type: 'object' }, Admin: { type: 'object' }, Account: { type: 'object', properties: { actor: { oneOf: [{ $ref: '#/components/schemas/User' }, { $ref: '#/components/schemas/Admin' }] } } } } }, paths: {} }, { outputDir, insertComponents: true });
    const content = await readFile(join(outputDir, 'components', 'Account', 'index.ts'), 'utf8');
    expect(content).toContain('z.union([UserSchema, AdminSchema])');
  });
  it('renders prototype-like component property names as computed keys', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    const schema = JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"},"nested":{"type":"object","properties":{"__proto__":{"type":"number"}},"required":["__proto__"]}},"required":["__proto__","nested"]}');
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, components: { schemas: { Safe: schema } }, paths: {} }, { outputDir, insertComponents: true });
    const content = await readFile(join(outputDir, 'components', 'Safe', 'index.ts'), 'utf8');
    expect(content).toContain('["__proto__"]: z.string()');
    expect(content).toContain('["__proto__"]: z.number()');
    expect(content).not.toContain('"__proto__":');
  });
  it('renders nested enum, const, and nullable schemas', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, components: { schemas: { Profile: { type: 'object', properties: { role: { enum: ['admin', 'user'] }, active: { const: true }, coordinates: { const: [1, 2] }, choices: { enum: [{ kind: 'a' }, { kind: 'b' }] }, nickname: { type: 'string', nullable: true } } } } }, paths: {} }, { outputDir, insertComponents: true });
    const content = await readFile(join(outputDir, 'components', 'Profile', 'index.ts'), 'utf8');
    expect(content).toContain('z.enum(["admin","user"])');
    expect(content).toContain('z.literal(true)');
    expect(content).not.toContain('z.literal([1,2])');
    expect(content).toContain('.meta({ const: [1,2] })');
    expect(content).toContain('.meta({ enum: [{"kind":"a"},{"kind":"b"}] })');
    expect(content).toContain('z.nullable(z.string())');
  });
  it('renders additional property component references', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, components: { schemas: { User: { type: 'object' }, Directory: { type: 'object', additionalProperties: { $ref: '#/components/schemas/User' } } } }, paths: {} }, { outputDir, insertComponents: true });
    const content = await readFile(join(outputDir, 'components', 'Directory', 'index.ts'), 'utf8');
    expect(content).toContain('import { UserSchema } from "../User/index";');
    expect(content).toContain('.catchall(UserSchema)');
  });
  it('uses lazy references for mutual component cycles', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, components: { schemas: { User: { type: 'object', properties: { organization: { $ref: '#/components/schemas/Organization' } } }, Organization: { type: 'object', properties: { owner: { $ref: '#/components/schemas/User' } } } } }, paths: {} }, { outputDir, insertComponents: true });
    const user = await readFile(join(outputDir, 'components', 'User', 'index.ts'), 'utf8');
    const organization = await readFile(join(outputDir, 'components', 'Organization', 'index.ts'), 'utf8');
    expect(user).toContain('z.lazy(() => OrganizationSchema)');
    expect(organization).toContain('z.lazy(() => UserSchema)');
  });
  it('keeps mutual component cycles lazy through nested object properties', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, components: { schemas: {
      Left: { type: 'object', properties: { nested: { type: 'object', properties: { right: { $ref: '#/components/schemas/Right' } } } } },
      Right: { type: 'object', properties: { nested: { type: 'object', properties: { left: { $ref: '#/components/schemas/Left' } } } } },
    } }, paths: {} }, { outputDir, insertComponents: true });
    const left = await readFile(join(outputDir, 'components', 'Left', 'index.ts'), 'utf8');
    const right = await readFile(join(outputDir, 'components', 'Right', 'index.ts'), 'utf8');
    expect(left).toContain('z.lazy(() => RightSchema)');
    expect(right).toContain('z.lazy(() => LeftSchema)');
  });
  it('preserves object additional property behavior', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, components: { schemas: { Strict: { type: 'object', additionalProperties: false }, Open: { type: 'object' }, ExplicitlyOpen: { type: 'object', additionalProperties: true }, Bounded: { type: 'object', properties: { value: { type: 'string' } }, minProperties: 1, maxProperties: 2 } } }, paths: {} }, { outputDir, insertComponents: true });
    expect(await readFile(join(outputDir, 'components', 'Strict', 'index.ts'), 'utf8')).toContain('.strict()');
    expect(await readFile(join(outputDir, 'components', 'Open', 'index.ts'), 'utf8')).toContain('.passthrough()');
    expect(await readFile(join(outputDir, 'components', 'ExplicitlyOpen', 'index.ts'), 'utf8')).toContain('.passthrough()');
    const bounded = await readFile(join(outputDir, 'components', 'Bounded', 'index.ts'), 'utf8');
    expect(bounded).toContain('.meta({ minProperties: 1 })');
    expect(bounded).toContain('.meta({ maxProperties: 2 })');
  });
  it('preserves array component constraints', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, components: { schemas: { Tags: { type: 'array', title: 'Tags', description: 'Unique tags', items: { type: 'string' }, minItems: 1, maxItems: 3, uniqueItems: true } } }, paths: {} }, { outputDir, insertComponents: true });
    const content = await readFile(join(outputDir, 'components', 'Tags', 'index.ts'), 'utf8');
    expect(content).toContain('z.array(z.string()).min(1).max(3)');
    expect(content).toContain('new Set(items.map');
    expect(content).toContain('.meta({ uniqueItems: true })');
    expect(content).toContain('.meta({"title":"Tags","description":"Unique tags"})');
  });
  it('renders tuple component schemas recursively', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, components: { schemas: {
      Pair: { type: 'array', prefixItems: [{ type: 'string' }, { type: 'integer', minimum: 5 }], items: false, minItems: 2 },
      Flexible: { type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }], minItems: 1, maxItems: 3 },
    } }, paths: {} }, { outputDir, insertComponents: true });
    const content = await readFile(join(outputDir, 'components', 'Pair', 'index.ts'), 'utf8');
    expect(content).toContain('z.tuple([z.string(), z.number().int().min(5)])');
    const flexible = await readFile(join(outputDir, 'components', 'Flexible', 'index.ts'), 'utf8');
    expect(flexible).toContain('z.tuple([z.string(), z.number().optional()]).rest(z.unknown())');
    expect(flexible).toContain('.refine((items) => items.length <= 3)');
    expect(flexible).toContain('"prefixItems"');
  });
  it('renders tuple rest schemas', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, components: { schemas: { Values: { type: 'array', prefixItems: [{ type: 'string' }], items: { type: 'number' } } } }, paths: {} }, { outputDir, insertComponents: true });
    const content = await readFile(join(outputDir, 'components', 'Values', 'index.ts'), 'utf8');
    expect(content).toContain('.rest(z.number())');
  });
  it('uses component references for path-level parameter schemas', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, components: { schemas: { UserId: { type: 'string', format: 'uuid' } } }, paths: { '/users/{id}': { parameters: [{ name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/UserId' } }], get: { responses: { '200': { description: 'ok' } } } } } }, { outputDir, insertComponents: true, useComponentAsReference: true });
    const content = await readFile(join(outputDir, 'users', '{id}', 'get', 'index.ts'), 'utf8');
    expect(content).toContain("import { UserIdSchema } from '../../../components/index';");
    expect(content).toContain('params: z.object({ ["id"]: UserIdSchema })');
    expect(content).not.toContain('["id"]: z.any()');

    const inlineOutputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, components: { schemas: { UserId: { type: 'string', format: 'uuid' } } }, paths: { '/users/{id}': { parameters: [{ name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/UserId' } }], get: { responses: { '200': { description: 'ok' } } } } } }, { outputDir: inlineOutputDir, manifest: false });
    const inlineContent = await readFile(join(inlineOutputDir, 'users', '{id}', 'get', 'index.ts'), 'utf8');
    expect(inlineContent).toContain('params: z.object({ ["id"]: z.string().uuid() })');
  });
  it('uses component references nested inside endpoint schemas', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, components: { schemas: { UserId: { type: 'string', format: 'uuid' } } }, paths: { '/users': { get: { responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object', properties: { id: { $ref: '#/components/schemas/UserId' } }, required: ['id'] } } } } } } } } }, { outputDir, insertComponents: true, useComponentAsReference: true });
    const content = await readFile(join(outputDir, 'users', 'get', 'index.ts'), 'utf8');
    expect(content).toContain("import { UserIdSchema } from '../../components/index';");
    expect(content).toContain('200: z.object({ ["id"]: UserIdSchema })');
    expect(content).not.toContain('["id"]: z.any()');

    const inlineOutputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, components: { schemas: { UserId: { type: 'string', format: 'uuid' } } }, paths: { '/users': { get: { responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object', properties: { id: { $ref: '#/components/schemas/UserId' } }, required: ['id'] } } } } } } } } }, { outputDir: inlineOutputDir, manifest: false });
    const inlineContent = await readFile(join(inlineOutputDir, 'users', 'get', 'index.ts'), 'utf8');
    expect(inlineContent).toContain('200: z.object({ ["id"]: z.string().uuid() })');
  });
  it('imports exact component response references', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, components: { schemas: { User: { type: 'object' } } }, paths: { '/users': { get: { responses: { '200': { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } } } } } }, { outputDir, insertComponents: true, useComponentAsReference: true });
    const content = await readFile(join(outputDir, 'users', 'get', 'index.ts'), 'utf8');
    expect(content).toContain("import { UserSchema } from '../../components/index';");
    expect(content).toContain('200: UserSchema');
  });
  it('rejects circular input before writing a manifest', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    const input: any = { openapi: '3.1.0', info: { title: 'Test', version: '1' }, paths: {} }; input.self = input;
    await expect(generateApiDocsFiles(input, { outputDir })).rejects.toThrow('circular OpenAPI document');
  });
  it('supports flat generation without a manifest', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    const files = await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, paths: { '/users': { get: { responses: { '200': { description: 'ok' } } } } } }, { outputDir, mode: 'flat', manifest: false });
    expect(files[0].file).toBe('users/get/index.ts');
    await expect(readFile(join(outputDir, '.zopia-manifest.json'), 'utf8')).rejects.toThrow();
  });
  it('does not require auth when an empty security alternative allows anonymous access', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, paths: {
      '/required': { get: { security: [{ apiKey: [] }], responses: { '200': { description: 'ok' } } } },
      '/optional': { get: { security: [{ apiKey: [] }, {}], responses: { '200': { description: 'ok' } } } },
    } }, { outputDir, manifest: false });
    const required = await readFile(join(outputDir, 'required', 'get', 'index.ts'), 'utf8');
    const optional = await readFile(join(outputDir, 'optional', 'get', 'index.ts'), 'utf8');
    expect(required).toContain('auth: "YES"');
    expect(optional).toContain('auth: "NO"');
  });
  it('preserves prototype-like parameter and request example names safely', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    const examples = JSON.parse('{"__proto__":{"value":{"safe":true}},"named":{"value":1}}');
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, paths: { '/examples': { post: { parameters: [{ name: '__proto__', in: 'query', schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object' }, examples } } }, responses: { '200': { description: 'ok' } } } } } }, { outputDir, manifest: false });
    const content = await readFile(join(outputDir, 'examples', 'post', 'index.ts'), 'utf8');
    expect(content).toContain('query: z.object({ ["__proto__"]: z.string().optional() })');
    const encoded = content.match(/examples: JSON\.parse\(("(?:\\.|[^"\\])*")\),/)?.[1];
    expect(encoded).toBeDefined();
    const generatedExamples = JSON.parse(JSON.parse(encoded!));
    expect(Object.prototype.hasOwnProperty.call(generatedExamples.request, '__proto__')).toBe(true);
    expect(generatedExamples.request.__proto__).toEqual({ value: { safe: true } });
    expect(generatedExamples.request.named).toEqual({ value: 1 });
    expect((Object.prototype as any).safe).toBeUndefined();
  });
  it('escapes source metadata in generated comments', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test\nexport const injected = true;\u2028', version: '1' }, paths: { '/safe': { get: { responses: { '200': { description: 'ok' } } } } } }, { outputDir, manifest: false });
    const content = await readFile(join(outputDir, 'safe', 'get', 'index.ts'), 'utf8');
    expect(content).not.toContain('\nexport const injected = true;');
    expect(content).toContain('// Source: "Test\\nexport const injected = true;\\u2028 v1"');
  });
  it('writes a complete endpoint file', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    const files = await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, paths: { '/users/{id}': { get: { operationId: 'getUser', summary: 'Get user', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object' }, example: { id: 'u1' } } } } } } } } }, { outputDir });
    expect(files).toHaveLength(2);
    const content = await readFile(join(outputDir, 'users', '{id}', 'get', 'index.ts'), 'utf8');
    expect(content).toContain("import { makeApiConfig } from 'km-api';");
    expect(content).toContain('export const getUser');
    const numericDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, paths: { '/x': { get: { parameters: [{ name: '123', in: 'query', schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } } } } }, { outputDir: numericDir });
    const numericContent = await readFile(join(numericDir, 'x', 'get', 'index.ts'), 'utf8');
    expect(numericContent).toContain('["123"]: z.string()');
    const oddDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, paths: { '/x': { get: { operationId: 'get-user', responses: { '200': { description: 'ok' } } } } } }, { outputDir: oddDir });
    expect(await readFile(join(oddDir, 'x', 'get', 'index.ts'), 'utf8')).toContain('export const getUser');
    const reservedDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, paths: { '/reserved': { get: { operationId: 'await', responses: { '200': { description: 'ok' } } } } } }, { outputDir: reservedDir });
    expect(await readFile(join(reservedDir, 'reserved', 'get', 'index.ts'), 'utf8')).toContain('export const awaitEndpoint');
    expect(content).toContain('pathShape: "/users/{id}"');
    expect(content).toContain('responseContentType');
    expect(content).toContain('examples:');
    expect(content).toContain('u1');
    const metadataDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, security: [{ apiKey: [] }], paths: { '/meta': { get: { operationId: 'meta', tags: ['#users'], security: [], deprecated: true, responses: { '200': { description: 'ok' } } } } } }, { outputDir: metadataDir });
    const metadata = await readFile(join(metadataDir, 'meta', 'get', 'index.ts'), 'utf8');
    expect(metadata).toContain('tags: ["#users"]');
    expect(metadata).toContain('auth: "NO"');
    expect(metadata).toContain("deprecated: 'YES'");
    const swaggerDir = await mkdtemp(join(tmpdir(), 'zopia-'));
    await generateApiDocsFiles({ swagger: '2.0', info: { title: 'Test', version: '1' }, paths: { '/legacy': { get: { responses: { '200': { description: 'ok', examples: { 'application/json': { id: 'legacy' } } } } } } } }, { outputDir: swaggerDir });
    expect(await readFile(join(swaggerDir, 'legacy', 'get', 'index.ts'), 'utf8')).toContain('legacy');
  });
});
