import type {
  GeoJSONSourceSpecification,
  SourceSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { GeoJsonObject } from 'geojson';
import type { TileCoordinate } from './tile-request';
import type { ParsedTile } from './vector-tile';
import { GeoJSONVT } from '@maplibre/geojson-vt';
import { fromGeojsonVt } from '@maplibre/vt-pbf';
import { createTileKey } from './tile-request';
import { parseVectorTile } from './vector-tile';

// GeoJSON source 会先转成内存中的“向量瓦片形态”，这样下游渲染链路可以保持单轨实现。
export const GEOJSON_SOURCE_LAYER = '_geojson';

type SourceEntryState = 'failed' | 'idle' | 'ready' | 'requesting';

interface SourceEntryRecord {
  abortController?: AbortController;
  error?: unknown;
  key: string;
  promise?: Promise<ParsedTile>;
  state: SourceEntryState;
  value?: ParsedTile;
}

interface GeojsonSourceCacheOptions {
  loadData?: (
    source: GeoJSONSourceSpecification,
    signal: AbortSignal,
  ) => Promise<GeoJsonObject>;
  source: SourceSpecification;
  sourceId: string;
}

const EMPTY_TILE = parseVectorTile(new ArrayBuffer(0));
type GeojsonTileIndexInput = ConstructorParameters<typeof GeoJSONVT>[0];
type GeojsonVtLayers = Parameters<typeof fromGeojsonVt>[0];

export class GeojsonSourceCache {
  readonly sourceType = 'geojson';

  private destroyed = false;
  private readonly entries = new Map<string, SourceEntryRecord>();
  private readonly loadData: (
    source: GeoJSONSourceSpecification,
    signal: AbortSignal,
  ) => Promise<GeoJsonObject>;

  private source: GeoJSONSourceSpecification;
  private sourceSignature: string;
  private readonly sourceId: string;
  private tileIndexAbortController?: AbortController;
  private tileIndexPromise?: Promise<GeoJSONVT>;

  constructor(options: GeojsonSourceCacheOptions) {
    if (options.source.type !== 'geojson') {
      throw new Error('GeojsonSourceCache only supports geojson sources.');
    }

    this.loadData = options.loadData ?? loadGeojsonData;
    this.source = options.source;
    this.sourceId = options.sourceId;
    this.sourceSignature = JSON.stringify(options.source);
  }

  async requestTile(coordinate: TileCoordinate) {
    const key = createTileKey(
      this.sourceId,
      coordinate.level,
      coordinate.x,
      coordinate.y,
    );
    const existingEntry = this.entries.get(key);
    if (existingEntry?.state === 'ready' && existingEntry.value !== undefined) {
      return existingEntry.value;
    }
    if (existingEntry?.promise) {
      return existingEntry.promise;
    }

    const entry = existingEntry ?? this.createEntry(key);
    const abortController = new AbortController();
    entry.abortController = abortController;
    entry.error = undefined;
    entry.state = 'requesting';
    entry.promise = this.getTileIndex()
      .then((tileIndex) => {
        if (abortController.signal.aborted) {
          throw createAbortError();
        }

        return getParsedTile(tileIndex, coordinate);
      })
      .then((value) => {
        if (abortController.signal.aborted) {
          throw createAbortError();
        }

        entry.abortController = undefined;
        entry.promise = undefined;
        entry.state = 'ready';
        entry.value = value;
        return value;
      })
      .catch((error) => {
        entry.abortController = undefined;
        entry.promise = undefined;
        if (abortController.signal.aborted || isAbortError(error)) {
          entry.error = undefined;
          entry.state = 'idle';
          throw error;
        }

        entry.error = error;
        entry.state = 'failed';
        throw error;
      });

    return entry.promise;
  }

  updateSource(source: SourceSpecification) {
    if (source.type !== 'geojson') {
      throw new Error('GeojsonSourceCache only supports geojson sources.');
    }

    const nextSignature = JSON.stringify(source);
    if (nextSignature === this.sourceSignature) {
      return;
    }

    this.source = source;
    this.sourceSignature = nextSignature;
    this.reset();
  }

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    if (this.destroyed) {
      return;
    }

    this.reset();
    this.destroyed = true;
  }

  private createEntry(key: string) {
    const entry: SourceEntryRecord = {
      key,
      state: 'idle',
    };
    this.entries.set(key, entry);
    return entry;
  }

  private async getTileIndex(): Promise<GeoJSONVT> {
    if (this.tileIndexPromise) {
      return this.tileIndexPromise;
    }

    const abortController = new AbortController();
    this.tileIndexAbortController = abortController;
    this.tileIndexPromise = this.loadData(this.source, abortController.signal)
      .then((data) => {
        if (abortController.signal.aborted) {
          throw createAbortError();
        }

        const tileIndex = new GeoJSONVT(cloneGeojson(data) as GeojsonTileIndexInput);
        this.tileIndexAbortController = undefined;
        return tileIndex;
      })
      .catch((error) => {
        this.tileIndexAbortController = undefined;
        this.tileIndexPromise = undefined;
        throw error;
      });

    return this.tileIndexPromise;
  }

  private reset() {
    this.tileIndexAbortController?.abort();
    this.tileIndexAbortController = undefined;
    this.tileIndexPromise = undefined;
    for (const entry of this.entries.values()) {
      entry.abortController?.abort();
    }
    this.entries.clear();
  }
}

function getParsedTile(tileIndex: GeoJSONVT, coordinate: TileCoordinate) {
  const tile = tileIndex.getTile(
    coordinate.level,
    coordinate.x,
    coordinate.y,
  );
  if (!tile) {
    return EMPTY_TILE;
  }

  // geojson-vt 的输出会重新编码成一张“合成向量瓦片”，
  // 这样 FeatureTile 提取阶段就能复用普通 MVT 的 source-layer 查找逻辑。
  const encoded = fromGeojsonVt({
    [GEOJSON_SOURCE_LAYER]: tile,
  } as GeojsonVtLayers);
  const tileBuffer = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(tileBuffer).set(encoded);
  return parseVectorTile(tileBuffer);
}

async function loadGeojsonData(
  source: GeoJSONSourceSpecification,
  signal: AbortSignal,
): Promise<GeoJsonObject> {
  if (typeof source.data !== 'string') {
    return source.data as GeoJsonObject;
  }

  const response = await fetch(source.data, { signal });
  if (!response.ok) {
    throw new Error(`Failed to load geojson: ${source.data}`);
  }

  return await response.json() as GeoJsonObject;
}

function cloneGeojson(data: GeoJsonObject): GeoJsonObject {
  if (typeof structuredClone === 'function') {
    return structuredClone(data);
  }

  return JSON.parse(JSON.stringify(data)) as GeoJsonObject;
}

function createAbortError() {
  return Object.assign(new Error('aborted'), {
    name: 'AbortError',
  });
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}
