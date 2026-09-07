/** Uncontrolled <details> initial open. React has no defaultOpen for details. */
export function seedDetailsOpen(el: HTMLDetailsElement | null, shouldOpen: boolean): void {
  if (!el || el.dataset.seeded === '1') return;
  el.dataset.seeded = '1';
  el.open = shouldOpen;
}
