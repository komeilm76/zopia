import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
}

/** `git` for revisions that may legitimately not exist in this clone (see the shallow note below). */
function gitOptional(args: string[]): string | undefined {
  try { return git(args); }
  catch { return undefined; }
}

describe('changelog history contract', () => {
  it('T-17/R-172/R-173/R-174: changelog headings and user-facing bullets follow the release format', () => {
    const changelog = readFileSync(join(repositoryRoot, 'CHANGELOG.md'), 'utf8');
    const releaseHeadings = [...changelog.matchAll(/^## \[([^\]]+)](?: - (\d{4}-\d{2}-\d{2}))?$/gm)];
    expect(releaseHeadings[0]?.[1]).toBe('Unreleased');
    for (const [, version, date] of releaseHeadings.slice(1)) {
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(`${date}T00:00:00Z`))).toBe(false);
    }
    const governedHistory = changelog.slice(0, changelog.indexOf('\n## [0.0.1]'));
    const sectionHeadings = [...governedHistory.matchAll(/^### (.+)$/gm)].map((match) => match[1]);
    const allowedSections = ['✨ Added', '🔄 Changed', '⚠️ Deprecated', '🗑️ Removed', '🐛 Fixed', '🛡️ Security'];
    expect(sectionHeadings.filter((heading) => !allowedSections.includes(heading))).toEqual([]);
    for (const bullet of changelog.matchAll(/^- (.+)$/gm)) expect(bullet[1]).toMatch(/^\p{Extended_Pictographic}\uFE0F?\s+\S/u);
  });

  it('T-17/R-161/R-171: every post-release user-visible commit updates the changelog', () => {
    const changelog = readFileSync(join(repositoryRoot, 'CHANGELOG.md'), 'utf8');
    expect(changelog).toMatch(/^## \[Unreleased]$/m);

    const releaseCommit = git(['log', '--format=%H', '--grep=^chore(release):', '-1']);
    if (!releaseCommit) return;
    // The release commit's parent is missing from a shallow clone (the publish workflow
    // runs this gate on `actions/checkout` depth 1) and from a repository whose first
    // commit is the release. There is no history to audit in either case; full clones —
    // developer machines and `git fetch --unshallow` — still walk the real range.
    if (gitOptional(['rev-parse', '--verify', '--quiet', `${releaseCommit}^`]) === undefined) return;
    const commits = git(['rev-list', `${releaseCommit}^..HEAD`]).split(/\r?\n/).filter(Boolean);
    const missing: string[] = [];
    for (const commit of commits) {
      const files = git(['diff-tree', '--no-commit-id', '--name-only', '-r', commit]).split(/\r?\n/).filter(Boolean);
      const userVisible = files.some((file) => /^(?:src\/|docs\/|bin\/|README\.md$|package\.json$)/.test(file));
      if (userVisible && !files.includes('CHANGELOG.md')) missing.push(`${commit.slice(0, 12)} ${git(['show', '-s', '--format=%s', commit])}`);
    }
    expect(missing).toEqual([]);
  });
});
