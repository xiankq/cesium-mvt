import type { StylePropertySpecification } from '@maplibre/maplibre-gl-style-spec';
import { normalizePropertyExpression } from '@maplibre/maplibre-gl-style-spec';

export interface StyleExpressionCacheOptions {
  maxSize?: number;
}

export class StyleExpressionCache {
  private readonly cache = new Map<string, unknown>();
  private readonly maxSize: number;

  constructor(options: StyleExpressionCacheOptions = {}) {
    this.maxSize = options.maxSize ?? 100;
  }

  getOrCreate(
    expression: unknown,
    type: string,
    spec?: StylePropertySpecification,
  ): unknown {
    const key = this.createKey(expression, type);

    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    const compiled = this.compileExpression(expression, type, spec);

    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, compiled);
    return compiled;
  }

  size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }

  private createKey(expression: unknown, type: string): string {
    return `${type}:${JSON.stringify(expression)}`;
  }

  private compileExpression(
    expression: unknown,
    type: string,
    spec?: StylePropertySpecification,
  ): unknown {
    const defaultSpec = this.getDefaultSpec(type);
    const finalSpec = spec ?? defaultSpec;

    return normalizePropertyExpression(expression as any, finalSpec);
  }

  private getDefaultSpec(type: string): StylePropertySpecification {
    const specs: Record<string, StylePropertySpecification> = {
      number: {
        'type': 'number',
        'property-type': 'data-driven',
        'expression': {
          interpolated: true,
          parameters: ['zoom', 'feature', 'feature-state'],
        },
        'transition': true,
        'default': 0,
      },
      string: {
        'type': 'string',
        'property-type': 'data-driven',
        'expression': {
          interpolated: false,
          parameters: ['zoom', 'feature', 'feature-state'],
        },
        'transition': false,
        'default': '',
      },
      boolean: {
        'type': 'boolean',
        'property-type': 'data-driven',
        'expression': {
          interpolated: false,
          parameters: ['zoom', 'feature', 'feature-state'],
        },
        'transition': false,
        'default': false,
      },
      color: {
        'type': 'color',
        'property-type': 'data-driven',
        'expression': {
          interpolated: true,
          parameters: ['zoom', 'feature', 'feature-state'],
        },
        'transition': true,
        'default': '#000000',
        'overridable': true,
      },
    };

    return specs[type] ?? specs.number;
  }
}
