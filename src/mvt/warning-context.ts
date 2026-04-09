import type { CompiledStyleLayer } from './types';
import { logWarning } from './log';

export interface WarningContext {
  debugLogging: boolean;
  warnedKeys: Set<string>;
}

export function createWarningContext(debugLogging: boolean): WarningContext {
  return {
    debugLogging,
    warnedKeys: new Set(),
  };
}

export function warnOnce(
  warningContext: WarningContext | undefined,
  warningKey: string,
  message: string,
  details?: unknown,
): void {
  if (!warningContext || warningContext.warnedKeys.has(warningKey)) {
    return;
  }

  warningContext.warnedKeys.add(warningKey);
  logWarning(warningContext.debugLogging, message, details);
}

export function warnUnsupportedLayerProperty(
  warningContext: WarningContext | undefined,
  layer: CompiledStyleLayer,
  section: 'layout' | 'paint',
  propertyName: string,
  details?: unknown,
): void {
  warnOnce(
    warningContext,
    `unsupported:${layer.id}:${section}:${propertyName}`,
    `样式属性当前尚未完整渲染，结果可能与 MapLibre 存在偏差: ${layer.id}.${propertyName}`,
    {
      details,
      layerId: layer.id,
      propertyName,
      section,
      type: layer.type,
      value: section === 'layout' ? layer.layout[propertyName] : layer.paint[propertyName],
    },
  );
}
