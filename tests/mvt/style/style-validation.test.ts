import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { validateStyle } from '@/mvt/style';

describe('style-validation', () => {
  it('应该返回合法样式的空错误列表', () => {
    const style: StyleSpecification = {
      version: 8,
      sources: {
        base: {
          type: 'vector',
          tiles: ['https://example.com/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [
        {
          id: 'background',
          type: 'background',
          paint: {
            'background-color': '#112233',
          },
        },
      ],
    };

    expect(validateStyle(style)).toEqual([]);
  });

  it('应该返回不合法样式的校验错误', () => {
    const style = {
      version: 8,
      sources: {},
      layers: [
        {
          id: 'background',
          type: 'background',
          paint: {
            'background-color': 123,
          },
        },
      ],
    } as unknown as StyleSpecification;

    const errors = validateStyle(style);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.message).toContain('background-color');
  });
});
