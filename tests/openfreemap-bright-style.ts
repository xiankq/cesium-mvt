import type { MvtStyleSpecification } from '../src/mvt/types';
import { StyleSet } from '../src/mvt/style/style-set';

export const openFreeMapBrightStyleUrl = 'https://tiles.openfreemap.org/styles/bright';
export const openFreeMapBrightSourceId = 'openmaptiles';

let stylePromise: Promise<MvtStyleSpecification> | undefined;
let styleSetPromise: Promise<StyleSet> | undefined;

export function loadOpenFreeMapBrightStyle(): Promise<MvtStyleSpecification> {
  if (!stylePromise) {
    stylePromise = fetch(openFreeMapBrightStyleUrl)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch OpenFreeMap bright style: ${response.status} ${response.statusText}`);
        }

        return await response.json() as MvtStyleSpecification;
      });
  }

  return stylePromise;
}

export function loadOpenFreeMapBrightStyleSet(): Promise<StyleSet> {
  if (!styleSetPromise) {
    styleSetPromise = loadOpenFreeMapBrightStyle()
      .then(styleSpecification => StyleSet
        .fromSpecification(styleSpecification, {
          baseUrl: openFreeMapBrightStyleUrl,
          source: openFreeMapBrightSourceId,
        })
        .resolveVectorSource(fetch)
        .then(styleSet => styleSet.resolveSpriteSource(fetch)));
  }

  return styleSetPromise;
}
