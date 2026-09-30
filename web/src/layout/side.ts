/**
 * The sidebar's navigation scrolls on its own when it runs out of room
 * (brand above, the signed-in person below). Opening a page whose item sits
 * out of view scrolls just that list to it; scrollIntoView is not used, as it
 * can also slide the clipped shell itself.
 */
export function revealSelected(from: HTMLElement | null, index: number): void {
  const list = from?.closest<HTMLElement>(".side-scroll");
  const item = list?.querySelectorAll<HTMLElement>(".side-item")[index];
  if (!list || !item) return;
  // Measured on screen, then turned back into the list's own pixels: the
  // shell is zoomed to fit the window, and scrollTop is not.
  const box = list.getBoundingClientRect();
  const at = item.getBoundingClientRect();
  const scale = box.height / list.offsetHeight || 1;
  if (at.top < box.top) list.scrollTop += (at.top - box.top) / scale - 12;
  else if (at.bottom > box.bottom) list.scrollTop += (at.bottom - box.bottom) / scale + 12;
}
