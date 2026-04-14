import type {
  StyleSpecification,
  ValidationError,
} from '@maplibre/maplibre-gl-style-spec';
import {
  latest,
  validateStyleMin,
} from '@maplibre/maplibre-gl-style-spec';

// 直接复用 MapLibre 的浏览器端校验入口，避免在项目内重复维护一套样式校验逻辑。
export function validateStyle(
  style: StyleSpecification,
  styleSpec = latest,
): ValidationError[] {
  return validateStyleMin(style, styleSpec);
}
