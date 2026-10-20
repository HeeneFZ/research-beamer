import { useEffect, useMemo, useRef } from 'react';
import { projectAssets } from '../model/projectSync';
import { useStore } from '../state/store';

/** Native events carry project identity; polling and file I/O stay out of React. */
export function useExternalProject(): void {
  const folder = useStore((state) => state.folder);
  const id = useStore((state) => state.projectId);
  const deck = useStore((state) => state.deck);
  const exiting = useStore((state) => state.projectExiting);
  const assets = useMemo(() => JSON.stringify(projectAssets(deck)), [deck]);
  const watched = useRef<string | null>(null);
  useEffect(() => {
    if (!window.api.projectWatchEnabled || !window.api.onProjectChanged) return;
    return window.api.onProjectChanged((change) => useStore.getState().receiveProjectChange(change));
  }, []);
  useEffect(() => {
    if (!window.api.projectWatchEnabled || !window.api.watchProject) return;
    if (!folder) {
      if (watched.current) void window.api.unwatchProject(watched.current);
      watched.current = null; return;
    }
    watched.current = id;
    void window.api.watchProject({ id, folder, md: useStore.getState().diskMd, assets: JSON.parse(assets) }).catch((error) => {
      if (useStore.getState().projectId === id) useStore.getState().setFlashMsg('外部文件检测未启动：' + String(error));
    });
  }, [folder, id, assets]);
  useEffect(() => () => { if (watched.current && window.api.unwatchProject) void window.api.unwatchProject(watched.current); }, []);
  useEffect(() => {
    if (exiting) return;
    // Draft flushing uses flushSync and must run outside React's effect phase.
    const timer = window.setTimeout(() => useStore.getState().retryProjectChanges(), 0);
    return () => clearTimeout(timer);
  }, [exiting]);
}
