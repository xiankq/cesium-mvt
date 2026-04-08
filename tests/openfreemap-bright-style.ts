import type { MvtStyleSpecification } from '../src/mvt/mvt-types';
import { MvtStyleSet } from '../src/mvt/style/mvt-style-set';

export const openFreeMapBrightStyleUrl = 'https://tiles.openfreemap.org/styles/bright';
export const openFreeMapBrightSourceId = 'openmaptiles';

let stylePromise: Promise<MvtStyleSpecification> | undefined;
let styleSetPromise: Promise<MvtStyleSet> | undefined;

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

export function loadOpenFreeMapBrightStyleSet(): Promise<MvtStyleSet> {
  if (!styleSetPromise) {
    styleSetPromise = loadOpenFreeMapBrightStyle()
      .then(styleSpecification => MvtStyleSet
        .fromSpecification(styleSpecification, {
          baseUrl: openFreeMapBrightStyleUrl,
          source: openFreeMapBrightSourceId,
        })
        .resolveVectorSource(fetch)
        .then(styleSet => styleSet.resolveSpriteSource(fetch)));
  }

  return styleSetPromise;
}
