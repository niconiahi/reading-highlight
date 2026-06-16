export function attach_keybindings(handlers: {
  on_toggle_play: () => void;
  on_skip: (delta_seconds: number) => void;
}): () => void {
  const on_key = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      handlers.on_toggle_play();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      handlers.on_skip(-10);
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      handlers.on_skip(10);
    }
  };
  window.addEventListener('keydown', on_key);
  return () => window.removeEventListener('keydown', on_key);
}
