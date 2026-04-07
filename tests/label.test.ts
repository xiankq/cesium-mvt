import { describe, expect, it } from 'vitest'
import { buildSymbolDedupeKey, fontStackToCss } from '../src/mvt/render/label'

describe('fontStackToCss', () => {
  it('normalizes comma-separated font strings the same way as arrays', () => {
    expect(
      fontStackToCss('Open Sans Regular, Arial Unicode MS Regular'),
    ).toBe('"Open Sans Regular", "Arial Unicode MS Regular"')
  })

  it('strips redundant quotes before rebuilding the CSS font list', () => {
    expect(
      fontStackToCss('"Open Sans Regular", Arial Unicode MS Regular'),
    ).toBe('"Open Sans Regular", "Arial Unicode MS Regular"')
  })
})

describe('buildSymbolDedupeKey', () => {
  it('stays stable across level-specific placement drift when feature ids match', () => {
    const baseCandidate = {
      featureId: 42,
      textKey: 'Main Street',
      iconImageName: undefined,
    }

    expect(
      buildSymbolDedupeKey(
        'road-label',
        {
          ...baseCandidate,
          position: { x: 10, y: 20, z: 30 },
        } as Parameters<typeof buildSymbolDedupeKey>[1],
        'Main Street',
      ),
    ).toBe(
      buildSymbolDedupeKey(
        'road-label',
        {
          ...baseCandidate,
          position: { x: 100, y: 200, z: 300 },
        } as Parameters<typeof buildSymbolDedupeKey>[1],
        'Main Street',
      ),
    )
  })

  it('falls back to position when feature ids are absent', () => {
    expect(
      buildSymbolDedupeKey(
        'poi',
        {
          featureId: undefined,
          textKey: 'Cafe',
          iconImageName: undefined,
          position: { x: 10, y: 20, z: 30 },
        } as Parameters<typeof buildSymbolDedupeKey>[1],
        'Cafe',
      ),
    ).not.toBe(
      buildSymbolDedupeKey(
        'poi',
        {
          featureId: undefined,
          textKey: 'Cafe',
          iconImageName: undefined,
          position: { x: 1000, y: 2000, z: 3000 },
        } as Parameters<typeof buildSymbolDedupeKey>[1],
        'Cafe',
      ),
    )
  })
})
