import { describe, expect, it } from 'vitest';
import { resolvePublicBase } from '@/build/public-path';

describe('public-path', () => {
  it('在未配置时使用根路径', () => {
    expect(resolvePublicBase()).toBe('/');
  });

  it('在 GitHub Pages 场景下默认使用相对路径', () => {
    expect(resolvePublicBase({ githubPages: true })).toBe('./');
  });

  it('会把自定义路径规范为带尾斜杠的形式', () => {
    expect(resolvePublicBase({ base: '/cesium-mvt' })).toBe('/cesium-mvt/');
  });
});
