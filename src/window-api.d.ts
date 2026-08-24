// window.api 契约（preload contextBridge 暴露的渲染端接口）。
// 单一事实源：修改此处必须同步 electron/preload.cjs 与 electron/main.cjs 的 handler。

declare global {
  interface Window {
    api: {
      isE2E: boolean;
      openProject(): Promise<{ md: string | null; folder: string; error?: string } | null>;
      loadExample(relPath: string): Promise<{ md: string | null; folder: string; error?: string } | null>;
      saveProject(p: { folder: string | null; md: string }): Promise<{ folder: string; error?: string } | null>;
      pickMedia(): Promise<{ path: string } | null>;
      importMedia(p: { srcPath: string; folder: string | null }): Promise<{ fileName: string; error?: string } | null>;
      ensureEpsPdf(p: { absPath: string }): Promise<{ pdf?: string; error?: string }>;
      readFile(absPath: string): Promise<{ data: Uint8Array } | { error: string }>;
      exportPDF(p: { suggestedName?: string }): Promise<{ path: string } | null>;
      showItem(absPath: string): Promise<void>;
      winMin(): void;
      winMax(): void;
      winClose(): void;
      saveMediaAs(p: { srcPath: string }): Promise<{ path: string; error?: string } | null>;
      openPresent(): Promise<{ ok: boolean; display?: number }>;
      closePresent(): void;
      sendPresentState(p: unknown): void;
      sendPresentEvent(e: { type: string; index?: number; label?: string }): void;
      onPresentState(cb: (p: unknown) => void): () => void;
      onPresentEvent(cb: (e: { type: string; index?: number; label?: string }) => void): () => void;
      readHistory(folder: string): Promise<{ json?: string; error?: string } | null>;
      writeHistory(p: { folder: string; json: string }): Promise<{ ok?: boolean; error?: string }>;
      saveRecording(p: { folder: string | null; name: string; data: ArrayBuffer }): Promise<{ path: string; error?: string }>;
      printPDF(p: { savePath: string }): Promise<{ path: string; bytes: number } | { error?: string }>;
    };
  }
}

export {};
