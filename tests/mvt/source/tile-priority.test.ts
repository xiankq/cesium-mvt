import type { TilePriorityOptions } from '@/mvt/source/tile-priority';
import { describe, expect, it } from 'vitest';
import { computeTilePriority } from '@/mvt/source/tile-priority';

describe('tile-priority', () => {
  describe('computeTilePriority', () => {
    it('should give higher priority to tiles closer to camera center', () => {
      const options1: TilePriorityOptions = {
        distanceToCamera: 100,
        screenSpaceError: 10,
        level: 10,
        isLoaded: false,
      };

      const options2: TilePriorityOptions = {
        distanceToCamera: 1000,
        screenSpaceError: 10,
        level: 10,
        isLoaded: false,
      };

      const priority1 = computeTilePriority(options1);
      const priority2 = computeTilePriority(options2);

      expect(priority1).toBeGreaterThan(priority2);
    });

    it('should give higher priority to tiles with higher SSE', () => {
      const options1: TilePriorityOptions = {
        distanceToCamera: 100,
        screenSpaceError: 100,
        level: 10,
        isLoaded: false,
      };

      const options2: TilePriorityOptions = {
        distanceToCamera: 100,
        screenSpaceError: 10,
        level: 10,
        isLoaded: false,
      };

      const priority1 = computeTilePriority(options1);
      const priority2 = computeTilePriority(options2);

      expect(priority1).toBeGreaterThan(priority2);
    });

    it('should give higher priority to lower level tiles', () => {
      const options1: TilePriorityOptions = {
        distanceToCamera: 100,
        screenSpaceError: 10,
        level: 5,
        isLoaded: false,
      };

      const options2: TilePriorityOptions = {
        distanceToCamera: 100,
        screenSpaceError: 10,
        level: 10,
        isLoaded: false,
      };

      const priority1 = computeTilePriority(options1);
      const priority2 = computeTilePriority(options2);

      expect(priority1).toBeGreaterThan(priority2);
    });

    it('should give lowest priority to loaded tiles', () => {
      const options1: TilePriorityOptions = {
        distanceToCamera: 100,
        screenSpaceError: 100,
        level: 5,
        isLoaded: true,
      };

      const options2: TilePriorityOptions = {
        distanceToCamera: 1000,
        screenSpaceError: 10,
        level: 10,
        isLoaded: false,
      };

      const priority1 = computeTilePriority(options1);
      const priority2 = computeTilePriority(options2);

      expect(priority2).toBeGreaterThan(priority1);
    });
  });
});
