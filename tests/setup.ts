import { afterEach, beforeEach, vi } from 'vitest';

interface MockCanvasContext {
  fillStyle: string;
  font: string;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  lineWidth: number;
  shadowBlur: number;
  shadowColor: string;
  strokeStyle: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  clearRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
  measureText: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  scale: ReturnType<typeof vi.fn>;
  setTransform: ReturnType<typeof vi.fn>;
  strokeText: ReturnType<typeof vi.fn>;
}

function createMockCanvasContext(): CanvasRenderingContext2D {
  const context: MockCanvasContext = {
    fillStyle: '',
    font: '',
    lineCap: 'butt',
    lineJoin: 'miter',
    lineWidth: 1,
    shadowBlur: 0,
    shadowColor: '',
    strokeStyle: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({
      width: text.length * 8,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
    })),
    restore: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),
    strokeText: vi.fn(),
  };

  return context as unknown as CanvasRenderingContext2D;
}

function createMockCanvas(): HTMLCanvasElement {
  const context = createMockCanvasContext();

  return {
    width: 0,
    height: 0,
    getContext: vi.fn((type: string) => {
      if (type !== '2d') {
        return null;
      }

      return context;
    }),
  } as unknown as HTMLCanvasElement;
}

beforeEach(() => {
  vi.stubGlobal('devicePixelRatio', 1);
  vi.stubGlobal('document', {
    createElement: vi.fn((tagName: string) => {
      if (tagName !== 'canvas') {
        throw new Error(`Unsupported test element: ${tagName}`);
      }

      return createMockCanvas();
    }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
