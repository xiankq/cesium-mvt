import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTileKey,
  createTileRequest,
} from '@/mvt/source/tile-request';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('tile-request', () => {
  it('构建 xyz 格式的瓦片 URL', () => {
    const request = createTileRequest({
      coordinate: {
        level: 4,
        x: 10,
        y: 6,
      },
      sourceId: 'base',
      tiles: ['https://tiles.example.com/{z}/{x}/{y}.pbf'],
    });

    expect(request).toEqual({
      coordinate: {
        level: 4,
        x: 10,
        y: 6,
      },
      key: createTileKey('base', 4, 10, 6),
      sourceId: 'base',
      url: 'https://tiles.example.com/4/10/6.pbf',
    });
  });

  it('对 TMS 模板翻转 y 坐标', () => {
    const request = createTileRequest({
      coordinate: {
        level: 3,
        x: 2,
        y: 1,
      },
      scheme: 'tms',
      sourceId: 'base',
      tiles: ['https://tiles.example.com/{z}/{x}/{y}.pbf'],
    });

    expect(request.url).toBe('https://tiles.example.com/3/2/6.pbf');
  });

  it('按瓦片坐标选择 MapLibre 瓦片模板', () => {
    const request = createTileRequest({
      coordinate: {
        level: 3,
        x: 2,
        y: 1,
      },
      sourceId: 'base',
      tiles: [
        'https://a.example.com/{z}/{x}/{y}.pbf',
        'https://b.example.com/{z}/{x}/{y}.pbf',
      ],
    });

    expect(request.url).toBe('https://b.example.com/3/2/1.pbf');
  });

  it('替换 MapLibre 瓦片 URL 占位符', () => {
    vi.stubGlobal('devicePixelRatio', 2);

    const request = createTileRequest({
      coordinate: {
        level: 2,
        x: 1,
        y: 2,
      },
      scheme: 'tms',
      sourceId: 'base',
      tiles: [
        'https://a.example.com/{z}/{x}/{y}.pbf',
        'https://{prefix}.example.com/{z}/{x}/{y}/{quadkey}{ratio}.pbf',
      ],
    });

    expect(request.url).toBe('https://12.example.com/2/1/1/21@2x.pbf');
  });

  it('替换 MapLibre bbox 占位符', () => {
    const request = createTileRequest({
      coordinate: {
        level: 1,
        x: 0,
        y: 0,
      },
      sourceId: 'base',
      tiles: [
        'https://example.com/{bbox-epsg-3857}.pbf',
      ],
    });

    expect(request.url).toBe(
      'https://example.com/-20037508.342789244,0,0,20037508.342789244.pbf',
    );
  });
});
