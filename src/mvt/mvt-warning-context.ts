import type { MvtCompiledStyleLayer } from './mvt-types';
import { logMvtWarning } from './mvt-log';

export interface MvtWarningContext {
  debugLogging: boolean;
  warnedKeys: Set<string>;
}

export function createMvtWarningContext(debugLogging: boolean): MvtWarningContext {
  return {
    debugLogging,
    warnedKeys: new Set(),
  };
}

export function warnMvtOnce(
  warningContext: MvtWarningContext | undefined,
  warningKey: string,
  message: string,
  details?: unknown,
): void {
  if (!warningContext || warningContext.warnedKeys.has(warningKey)) {
    return;
  }

  warningContext.warnedKeys.add(warningKey);
  logMvtWarning(warningContext.debugLogging, message, details);
}

export function warnUnsupportedLayerProperty(
  warningContext: MvtWarningContext | undefined,
  layer: MvtCompiledStyleLayer,
  section: 'layout' | 'paint',
  propertyName: string,
  details?: unknown,
): void {
  warnMvtOnce(
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
