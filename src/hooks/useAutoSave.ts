import { useEffect } from 'react';
import { useStore } from '../state/store';

/** 仅内容、目录和保存开关控制防抖，导航及后台排版不延迟保存。 */
export function useAutoSave(): void {
  const deck = useStore((s) => s.deck);
  const dirty = useStore((s) => s.dirty);
  const folder = useStore((s) => s.folder);
  const enabled = useStore((s) => s.autoSave);
  useEffect(() => {
    if (window.api.isE2E || !enabled || !dirty || !folder) return;
    const timer = window.setTimeout(() => {
      const s = useStore.getState();
      if (s.autoSave && s.dirty && s.folder === folder && s.deck === deck) void s.saveProject(false);
    }, 2000);
    return () => clearTimeout(timer);
  }, [deck, dirty, folder, enabled]);
}
