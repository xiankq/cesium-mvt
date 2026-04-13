import type { FilterSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { ExpressionContext } from './expression-evaluator';
import { evaluateExpression } from './expression-evaluator';

/**
 * Feature 过滤器上下文
 */
export type FeatureFilterContext = ExpressionContext;

/**
 * Feature 过滤器函数
 */
export type FeatureFilter = (context: FeatureFilterContext) => boolean;

/**
 * 创建 Feature 过滤器
 *
 * 将 MapLibre FilterSpecification 转换为可执行的过滤器函数
 *
 * @param filter - 过滤器规范
 * @returns 过滤器函数
 */
export function createFeatureFilter(filter: FilterSpecification | null | undefined): FeatureFilter {
  if (filter === null || filter === undefined) {
    return () => true;
  }

  if (filter === true) {
    return () => true;
  }

  if (filter === false) {
    return () => false;
  }

  if (!Array.isArray(filter) || filter.length === 0) {
    return () => true;
  }

  const [operator, ...args] = filter;

  switch (operator) {
    case '==':
      return createComparisonFilter('==', args);
    case '!=':
      return createComparisonFilter('!=', args);
    case '>':
      return createComparisonFilter('>', args);
    case '>=':
      return createComparisonFilter('>=', args);
    case '<':
      return createComparisonFilter('<', args);
    case '<=':
      return createComparisonFilter('<=', args);

    case 'all':
      return createAllFilter(args);
    case 'any':
      return createAnyFilter(args);
    case 'none':
      return createNoneFilter(args);
    case '!':
      return createNotFilter(args);

    case 'has':
      return createHasFilter(args);
    case '!has':
      return createNotHasFilter(args);

    case 'in':
      return createInFilter(args);
    case '!in':
      return createNotInFilter(args);

    default:
      return createExpressionFilter(filter);
  }
}

/**
 * 创建比较过滤器
 */
function createComparisonFilter(
  operator: '==' | '!=' | '>' | '>=' | '<' | '<=',
  args: unknown[],
): FeatureFilter {
  return (context: FeatureFilterContext): boolean => {
    const left = evaluateExpression(args[0], context);
    const right = evaluateExpression(args[1], context);

    switch (operator) {
      case '==':
        return left === right;
      case '!=':
        return left !== right;
      case '>':
        return compareNumbers(left, right) > 0;
      case '>=':
        return compareNumbers(left, right) >= 0;
      case '<':
        return compareNumbers(left, right) < 0;
      case '<=':
        return compareNumbers(left, right) <= 0;
      default:
        return false;
    }
  };
}

/**
 * 比较数字
 */
function compareNumbers(left: unknown, right: unknown): number {
  const leftNum = typeof left === 'number' ? left : Number(left);
  const rightNum = typeof right === 'number' ? right : Number(right);

  if (Number.isNaN(leftNum) || Number.isNaN(rightNum)) {
    return String(left).localeCompare(String(right));
  }

  return leftNum - rightNum;
}

/**
 * 创建 all 过滤器（逻辑与）
 */
function createAllFilter(args: unknown[]): FeatureFilter {
  const filters = args.map(arg => createFeatureFilter(arg as FilterSpecification));

  return (context: FeatureFilterContext): boolean => {
    return filters.every(filter => filter(context));
  };
}

/**
 * 创建 any 过滤器（逻辑或）
 */
function createAnyFilter(args: unknown[]): FeatureFilter {
  const filters = args.map(arg => createFeatureFilter(arg as FilterSpecification));

  return (context: FeatureFilterContext): boolean => {
    return filters.some(filter => filter(context));
  };
}

/**
 * 创建 none 过滤器（全部不满足）
 */
function createNoneFilter(args: unknown[]): FeatureFilter {
  const filters = args.map(arg => createFeatureFilter(arg as FilterSpecification));

  return (context: FeatureFilterContext): boolean => {
    return !filters.some(filter => filter(context));
  };
}

/**
 * 创建 not 过滤器（逻辑非）
 */
function createNotFilter(args: unknown[]): FeatureFilter {
  const filter = createFeatureFilter(args[0] as FilterSpecification);

  return (context: FeatureFilterContext): boolean => {
    return !filter(context);
  };
}

/**
 * 创建 has 过滤器
 */
function createHasFilter(args: unknown[]): FeatureFilter {
  return (context: FeatureFilterContext): boolean => {
    const propertyName = String(args[0]);
    return propertyName in context.properties;
  };
}

/**
 * 创建 !has 过滤器
 */
function createNotHasFilter(args: unknown[]): FeatureFilter {
  return (context: FeatureFilterContext): boolean => {
    const propertyName = String(args[0]);
    return !(propertyName in context.properties);
  };
}

/**
 * 创建 in 过滤器
 */
function createInFilter(args: unknown[]): FeatureFilter {
  const [valueExpr, ...values] = args;

  return (context: FeatureFilterContext): boolean => {
    const value = evaluateExpression(valueExpr, context);
    return values.includes(value);
  };
}

/**
 * 创建 !in 过滤器
 */
function createNotInFilter(args: unknown[]): FeatureFilter {
  const [valueExpr, ...values] = args;

  return (context: FeatureFilterContext): boolean => {
    const value = evaluateExpression(valueExpr, context);
    return !values.includes(value);
  };
}

/**
 * 创建表达式过滤器
 */
function createExpressionFilter(expression: unknown[]): FeatureFilter {
  return (context: FeatureFilterContext): boolean => {
    const result = evaluateExpression(expression, context);
    return Boolean(result);
  };
}
