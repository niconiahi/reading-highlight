export type Origin = { x: number; y: number };
export type RectLike = { left: number; top: number; width: number; height: number };

export const BLEED = 10;
export const SENTENCE_RADIUS = 8;
export const WORD_RADIUS = 4;
const PAD_X = 3;
const PAD_Y = 2;

export function get_local_line_rects(
  text_node: Text,
  start: number,
  end: number,
  origin: Origin,
): RectLike[] {
  const range = document.createRange();
  range.setStart(text_node, start);
  range.setEnd(text_node, end);
  const out: RectLike[] = [];
  for (const r of range.getClientRects()) {
    if (r.width <= 0 || r.height <= 0) continue;
    out.push({
      left: r.left - origin.x - PAD_X,
      top: r.top - origin.y - PAD_Y,
      width: r.width + PAD_X * 2,
      height: r.height + PAD_Y * 2,
    });
  }
  return out;
}
