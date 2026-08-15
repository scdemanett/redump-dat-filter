import { useEffect, useState } from 'react';

interface CopyMenuState {
  x: number;
  y: number;
  text: string;
}

function getCopyableText(target: EventTarget | null): string {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? 0;
    if (end > start) {
      return target.value.slice(start, end);
    }
  }

  return window.getSelection()?.toString() ?? '';
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    document.execCommand('copy');
  }
}

export function ContextCopyMenu() {
  const [menu, setMenu] = useState<CopyMenuState | null>(null);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      if (import.meta.env.DEV) {
        return;
      }
      event.preventDefault();
      const text = getCopyableText(event.target);
      if (!text) {
        setMenu(null);
        return;
      }
      setMenu({ x: event.clientX, y: event.clientY, text });
    };

    const dismiss = () => setMenu(null);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dismiss();
      }
    };

    window.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('click', dismiss);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('click', dismiss);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  if (!menu) {
    return null;
  }

  const left = Math.min(menu.x, window.innerWidth - 8);
  const top = Math.min(menu.y, window.innerHeight - 8);

  return (
    <div
      className="app-context-menu"
      style={{ left, top }}
      role="menu"
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        className="app-context-menu__item"
        role="menuitem"
        onClick={() => {
          void copyText(menu.text);
          setMenu(null);
        }}
      >
        Copy
      </button>
    </div>
  );
}
