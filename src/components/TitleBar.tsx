import { Minus, Square, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * Custom title bar.
 *
 * The window is undecorated so the Mica backdrop reaches the very top; these
 * buttons stand in for the ones Windows would have drawn.
 */
export function TitleBar() {
  const window = getCurrentWindow();

  return (
    <header className="titlebar">
      <div className="titlebar__drag">
        <span className="titlebar__mark" aria-hidden />
        <span className="titlebar__title">Vlyne</span>
      </div>

      <div className="titlebar__buttons">
        <button
          className="titlebar__button"
          onClick={() => window.minimize()}
          aria-label="Minimise"
        >
          <Minus size={15} />
        </button>
        <button
          className="titlebar__button"
          onClick={() => window.toggleMaximize()}
          aria-label="Maximise"
        >
          <Square size={12} />
        </button>
        <button
          className="titlebar__button titlebar__button--close"
          // `close` honours the close-to-tray setting: the Rust side decides
          // whether this hides the window or ends the process.
          onClick={() => window.close()}
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>
    </header>
  );
}
