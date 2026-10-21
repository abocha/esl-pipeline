import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const postbuildPath = fileURLToPath(new URL('../scripts/postbuild.js', import.meta.url));

function createFixture({ withConfigs }: { withConfigs: boolean }) {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-postbuild-'));
  const packageRoot = join(root, 'packages', 'orchestrator');
  const scriptPath = join(packageRoot, 'scripts', 'postbuild.js');
  mkdirSync(join(packageRoot, 'scripts'), { recursive: true });
  mkdirSync(join(packageRoot, 'dist'), { recursive: true });
  cpSync(postbuildPath, scriptPath);
  writeFileSync(
    join(packageRoot, 'dist', 'index.js'),
    'export {};\n//# sourceMappingURL=index.js.map\n',
  );
  if (withConfigs) {
    mkdirSync(join(packageRoot, 'configs'), { recursive: true });
    writeFileSync(join(packageRoot, 'configs', 'preset.yml'), 'fixture: true\n');
  }
  return { root, packageRoot, scriptPath };
}

describe('orchestrator postbuild runtime config copy', () => {
  it('copies runtime configs into dist and strips sourcemap comments on success', () => {
    const fixture = createFixture({ withConfigs: true });
    try {
      const result = spawnSync(process.execPath, [fixture.scriptPath], { encoding: 'utf8' });

      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(join(fixture.packageRoot, 'dist', 'configs', 'preset.yml'), 'utf8')).toBe(
        'fixture: true\n',
      );
      expect(readFileSync(join(fixture.packageRoot, 'dist', 'index.js'), 'utf8')).not.toMatch(
        /sourceMappingURL/u,
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('fails postbuild when required runtime configs cannot be copied', () => {
    const fixture = createFixture({ withConfigs: false });
    try {
      const result = spawnSync(process.execPath, [fixture.scriptPath], { encoding: 'utf8' });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/configs/u);
      expect(existsSync(join(fixture.packageRoot, 'dist', 'configs'))).toBe(false);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});
