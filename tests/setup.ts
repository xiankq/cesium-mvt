interface FakeStyleDeclaration {
  font?: string;
  opacity?: string | number;
  position?: string;
}

interface FakeElement {
  style: FakeStyleDeclaration;
}

interface FakeComputedStyle {
  getPropertyValue: (propertyName: string) => string;
}

const fontDeclarationPattern
  = /(?:(?<style>italic|oblique|normal)\s+)?(?:(?<weight>bold|normal|[1-9]00)\s+)?(?<size>\d+(?:\.\d+)?)px\s+(?<family>.+)/;

class FakeCanvasRenderingContext2D {
  fillStyle = '#000000';

  clearRect(): void {}

  fillRect(): void {}
}

class FakeCanvasElement {
  height = 0;
  width = 0;

  getContext(contextId: string): FakeCanvasRenderingContext2D | null {
    if (contextId !== '2d') {
      return null;
    }

    return new FakeCanvasRenderingContext2D();
  }
}

function installFakeDocument(): void {
  if (typeof document !== 'undefined') {
    return;
  }

  const bodyChildren = new Set<object>();
  const defaultView = {
    getComputedStyle(element: FakeElement): FakeComputedStyle {
      const font = element.style.font ?? '';
      const fontMatch = font.match(fontDeclarationPattern);
      const fontStyle = fontMatch?.groups?.style ?? 'normal';
      const fontWeight = fontMatch?.groups?.weight ?? 'normal';
      const fontSize = fontMatch?.groups?.size ? `${fontMatch.groups.size}px` : '30px';
      const fontFamily = fontMatch?.groups?.family ?? 'sans-serif';

      return {
        getPropertyValue(propertyName: string): string {
          switch (propertyName) {
            case 'font-family':
              return fontFamily;
            case 'font-size':
              return fontSize;
            case 'font-style':
              return fontStyle;
            case 'font-weight':
              return fontWeight;
            case 'line-height':
              return 'normal';
            default:
              return '';
          }
        },
      };
    },
  };

  const fakeDocument = {
    body: {
      appendChild(element: object): void {
        bodyChildren.add(element);
      },
      removeChild(element: object): void {
        bodyChildren.delete(element);
      },
    },
    createElement(tagName: string): FakeCanvasElement | FakeElement {
      if (tagName === 'canvas') {
        return new FakeCanvasElement();
      }

      return {
        style: {},
      };
    },
    defaultView,
    location: {
      href: 'http://localhost/',
    },
  };

  Object.assign(globalThis, {
    document: fakeDocument,
    location: fakeDocument.location,
    window: {
      document: fakeDocument,
      location: fakeDocument.location,
    },
  });
}

installFakeDocument();
