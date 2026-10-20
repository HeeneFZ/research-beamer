import { useStore } from '../state/store';

/** A project-wide conflict belongs beside file controls, outside the presentation. */
export function ProjectSyncNotice() {
  const change = useStore((state) => state.externalChange);
  const exiting = useStore((state) => state.projectExiting);
  if (!change) return null;
  return <div className="project-sync-notice" role="status">
    <span title={change.error}>{change.error ? '外部文件暂时无法载入，保留当前画面，等待后续更新。' : '外部版本与当前编辑不同；自动保存已暂停，请选择要保留的版本。'}</span>
    <button disabled={exiting || !change.deck} title="载入外部版本；本地编辑仍可通过撤销恢复"
      onClick={() => { void useStore.getState().resolveProjectChange('external'); }}>载入外部</button>
    <button disabled={exiting} title="覆盖前在工程目录保留上一版 .beamer-backup.md"
      onClick={() => { void useStore.getState().resolveProjectChange('local'); }}>用本地覆盖</button>
  </div>;
}
