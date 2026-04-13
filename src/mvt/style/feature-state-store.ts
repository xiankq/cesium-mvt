import { deepClone } from '../utils/common';

export interface FeatureStateTarget {
  id?: number | string;
  sourceId: string;
  sourceLayer?: string;
}

export type FeatureStateValues = Record<string, unknown>;

export type FeatureStateResolver = (
  target: FeatureStateTarget,
) => FeatureStateValues | undefined;

interface SourceFeatureStateRecord {
  generic: Map<string, FeatureStateValues>;
  sourceLayers: Map<string, Map<string, FeatureStateValues>>;
}

const EMPTY_FEATURE_STATE = Object.freeze({}) as FeatureStateValues;

export class FeatureStateStore {
  private readonly sources = new Map<string, SourceFeatureStateRecord>();

  clear(): void {
    this.sources.clear();
  }

  getFeatureState(target: FeatureStateTarget): FeatureStateValues | undefined {
    if (target.id === undefined) {
      return undefined;
    }

    const sourceRecord = this.sources.get(target.sourceId);
    if (!sourceRecord) {
      return undefined;
    }

    const featureKey = createFeatureKey(target.id);
    const genericState = sourceRecord.generic.get(featureKey);
    const layerState = target.sourceLayer
      ? sourceRecord.sourceLayers.get(target.sourceLayer)?.get(featureKey)
      : undefined;

    if (!genericState && !layerState) {
      return undefined;
    }

    return deepClone({
      ...genericState,
      ...layerState,
    });
  }

  setFeatureState(target: FeatureStateTarget, state: FeatureStateValues): boolean {
    if (target.id === undefined) {
      return false;
    }

    const sourceRecord = this.getOrCreateSourceRecord(target.sourceId);
    const featureKey = createFeatureKey(target.id);
    const stateMap = target.sourceLayer
      ? this.getOrCreateSourceLayerStateMap(sourceRecord, target.sourceLayer)
      : sourceRecord.generic;

    const nextState = deepClone(state);
    const currentState = stateMap.get(featureKey) ?? EMPTY_FEATURE_STATE;
    const mergedState = {
      ...currentState,
      ...nextState,
    };

    if (isShallowEqual(currentState, mergedState)) {
      return false;
    }

    stateMap.set(featureKey, mergedState);
    return true;
  }

  private getOrCreateSourceRecord(sourceId: string): SourceFeatureStateRecord {
    let sourceRecord = this.sources.get(sourceId);
    if (!sourceRecord) {
      sourceRecord = {
        generic: new Map<string, FeatureStateValues>(),
        sourceLayers: new Map<string, Map<string, FeatureStateValues>>(),
      };
      this.sources.set(sourceId, sourceRecord);
    }

    return sourceRecord;
  }

  private getOrCreateSourceLayerStateMap(
    sourceRecord: SourceFeatureStateRecord,
    sourceLayer: string,
  ): Map<string, FeatureStateValues> {
    let stateMap = sourceRecord.sourceLayers.get(sourceLayer);
    if (!stateMap) {
      stateMap = new Map<string, FeatureStateValues>();
      sourceRecord.sourceLayers.set(sourceLayer, stateMap);
    }

    return stateMap;
  }
}

function createFeatureKey(id: number | string): string {
  return `${typeof id}:${String(id)}`;
}

function isShallowEqual(
  left: FeatureStateValues,
  right: FeatureStateValues,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (const key of leftKeys) {
    if (!Object.hasOwn(right, key)) {
      return false;
    }

    if (!Object.is(left[key], right[key])) {
      return false;
    }
  }

  return true;
}
