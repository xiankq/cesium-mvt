import { describe, expect, it, vi } from 'vitest';
import { TileBudget } from '@/mvt/utils/tile-budget';

describe('tile-budget', () => {
  it('evicts the least recently used entry across caches', () => {
    const sourceEvict = vi.fn();
    const renderEvict = vi.fn();
    const budget = new TileBudget({
      maxBytes: 6,
    });

    budget.add('source/1', {
      byteLength: 3,
    }, sourceEvict);
    budget.add('render/1', {
      byteLength: 3,
    }, renderEvict);
    budget.touch('source/1');
    budget.add('render/2', {
      byteLength: 3,
    }, renderEvict);

    expect(sourceEvict).not.toHaveBeenCalled();
    expect(renderEvict).toHaveBeenCalledTimes(1);
    expect(renderEvict).toHaveBeenCalledWith('render/1');
    expect(budget.has('source/1')).toBe(true);
    expect(budget.has('render/1')).toBe(false);
    expect(budget.has('render/2')).toBe(true);
  });

  it('counts empty entries toward the shared budget', () => {
    const evict = vi.fn();
    const budget = new TileBudget({
      maxBytes: 2,
    });

    budget.add('empty/1', {
      byteLength: 0,
    }, evict);
    budget.add('empty/2', {
      byteLength: 0,
    }, evict);
    budget.add('empty/3', {
      byteLength: 0,
    }, evict);

    expect(evict).toHaveBeenCalledTimes(1);
    expect(evict).toHaveBeenCalledWith('empty/1');
    expect(budget.has('empty/1')).toBe(false);
    expect(budget.has('empty/2')).toBe(true);
    expect(budget.has('empty/3')).toBe(true);
  });
});
