/** The board's viewfinder (12 Parça ekle): 290 × 370, so width : height = 29 : 37. */
export const VIEWFINDER_MAX_WIDTH = 290;
const ASPECT = 29 / 37;
/** Room kept above and below the frame for its corners (2 pt outside the edge) and a little air. */
const VERTICAL_MARGIN = 8;

/**
 * Width of the viewfinder in the area left between the header and the controls. On a 6.1" phone that is the
 * board's 290 pt; on a 4.7" screen (iPhone SE, 667 pt) the area is shorter than 370 pt and a width-only frame
 * spilled over the close / Toplu buttons and the hint — so the frame also fits the height, keeping its shape.
 */
export function viewfinderWidth(areaWidth: number, areaHeight: number): number {
  const byHeight = Math.max(0, areaHeight - 2 * VERTICAL_MARGIN) * ASPECT;
  return Math.floor(Math.max(0, Math.min(VIEWFINDER_MAX_WIDTH, areaWidth, byHeight)));
}
