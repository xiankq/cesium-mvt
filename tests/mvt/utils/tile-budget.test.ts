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

  it('优先淘汰不可见瓦片，保留可见瓦片', () => {
    const evict = vi.fn();
    const budget = new TileBudget({
      maxBytes: 6,
    });

    budget.add('source/1', {
      byteLength: 3,
    }, evict);
    budget.add('render/1', {
      byteLength: 3,
    }, evict, true);
    budget.add('source/2', {
      byteLength: 3,
    }, evict);

    expect(evict).toHaveBeenCalledTimes(1);
    expect(evict).toHaveBeenCalledWith('source/1');
    expect(budget.has('source/1')).toBe(false);
    expect(budget.has('render/1')).toBe(true);
    expect(budget.has('source/2')).toBe(true);
  });

  it('允许可见瓦片使用软溢出预算，直到超过 overflow 上限才淘汰可见瓦片', () => {
    const evict = vi.fn();
    const budget = new TileBudget({
      maxBytes: 6,
      maximumCacheOverflowBytes: 3,
    });

    budget.add('render/1', {
      byteLength: 3,
    }, evict, true);
    budget.add('render/2', {
      byteLength: 3,
    }, evict, true);
    budget.add('render/3', {
      byteLength: 3,
    }, evict, true);

    expect(evict).not.toHaveBeenCalled();
    expect(budget.getCurrentBytes()).toBe(9);
    expect(budget.has('render/1')).toBe(true);
    expect(budget.has('render/2')).toBe(true);
    expect(budget.has('render/3')).toBe(true);

    budget.add('render/4', {
      byteLength: 3,
    }, evict, true);

    expect(evict).toHaveBeenCalledTimes(1);
    expect(evict).toHaveBeenCalledWith('render/1');
    expect(budget.getCurrentBytes()).toBe(9);
    expect(budget.has('render/1')).toBe(false);
    expect(budget.has('render/2')).toBe(true);
    expect(budget.has('render/3')).toBe(true);
    expect(budget.has('render/4')).toBe(true);
  });

  it('在 soft overflow 之前先清理不可见瓦片', () => {
    const evict = vi.fn();
    const budget = new TileBudget({
      maxBytes: 6,
      maximumCacheOverflowBytes: 3,
    });

    budget.add('render/1', {
      byteLength: 3,
    }, evict, true);
    budget.add('source/1', {
      byteLength: 3,
    }, evict, false);
    budget.add('render/2', {
      byteLength: 3,
    }, evict, true);

    expect(evict).toHaveBeenCalledTimes(1);
    expect(evict).toHaveBeenCalledWith('source/1');
    expect(budget.has('render/1')).toBe(true);
    expect(budget.has('source/1')).toBe(false);
    expect(budget.has('render/2')).toBe(true);
    expect(budget.getCurrentBytes()).toBe(6);
  });
});
