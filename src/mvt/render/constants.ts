/**
 * MVT 渲染常量定义
 */

/**
 * 瓦片像素大小
 * 标准 Web 墨卡托瓦片在缩放级别 0 时的像素宽度
 */
export const TILE_PIXEL_SIZE = 512;

/**
 * 单个图标估算字节大小
 * 用于内存估算
 */
export const ICON_BYTE_SIZE = 192;

/**
 * 单个标签基础估算字节大小
 * 用于内存估算
 */
export const LABEL_BASE_BYTE_SIZE = 256;

/**
 * 标签每行额外字节大小
 */
export const LABEL_LINE_BYTE_SIZE = 24;

/**
 * 标签文本每字符字节大小
 */
export const LABEL_CHAR_BYTE_SIZE = 4;

/**
 * 标签字体每字符字节大小
 */
export const LABEL_FONT_CHAR_BYTE_SIZE = 2;

/**
 * 图层高度步长
 * 用于控制不同图层在 Z 轴上的偏移
 */
export const LAYER_HEIGHT_STEP = 0.25;

/**
 * 图标高度偏移
 * 相对于图层基础高度的额外偏移
 */
export const SYMBOL_ICON_HEIGHT_OFFSET = 0.05;

/**
 * 文本高度偏移
 * 相对于图层基础高度的额外偏移
 */
export const SYMBOL_TEXT_HEIGHT_OFFSET = 0.1;
