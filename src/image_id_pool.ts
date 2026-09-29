/**
 * A rotation over a small set of kitty image ids.
 *
 * The graphics protocol deletes an image and all of its placements as soon as
 * new data is transmitted for the same id: "when re-transmitting image data for
 * a specific id, the existing image and all its placements must be deleted. The
 * new data replaces the old image data but is not actually displayed until a
 * placement for it is created."
 *
 * A renderer that retransmits every frame therefore must not reuse the id of the
 * image currently on screen, or the cells stay empty for the whole transfer.
 * That is imperceptible with small payloads but clearly visible with large ones.
 * Handing out a different id per redraw keeps the previous image on screen until
 * the new one has been fully received.
 *
 * Ids must be non-zero and fit in 24 bits, because the id is carried by the
 * placeholder foreground colour.
 */
export class ImageIdPool {
  private readonly ids: number[];
  private slot = 0;

  constructor(size = 8) {
    if (!Number.isInteger(size) || size < 2) {
      throw new RangeError("an image id pool needs at least two ids");
    }
    this.ids = Array.from({ length: size }, () => Math.floor(Math.random() * 0xFFFFFE) + 1);
  }

  /** Take the next id, cycling through the pool. */
  next(): number {
    const id = this.ids[this.slot]!;
    this.slot = (this.slot + 1) % this.ids.length;
    return id;
  }

  /** Every id the pool may hand out, for releasing them on dispose. */
  all(): readonly number[] {
    return this.ids;
  }
}
