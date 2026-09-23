/** Typing for the Electron preload bridge (offline desktop shell). */
interface ElectronFolderEntry {
  relPath: string;
  isDirectory: boolean;
}

interface ElectronBridge {
  isElectron: () => boolean;
  platform: NodeJS.Platform;
  onMenuAction?: (callback: (action: string) => void) => () => void;
  /**
   * v1.4.0 folder workspace — present only inside the Electron shell.
   * The allowed root is main-process state; only relPaths cross the bridge.
   */
  openFolder?: () => Promise<{ root: string; name: string } | null>;
  getFolder?: () => Promise<{ root: string; name: string } | null>;
  closeFolder?: () => Promise<void>;
  listFolder?: () => Promise<ElectronFolderEntry[]>;
  readFolderFile?: (relPath: string) => Promise<string>;
  writeFolderFile?: (relPath: string, content: string) => Promise<void>;
  createFolderEntry?: (relPath: string, isDirectory: boolean) => Promise<void>;
  renameFolderEntry?: (oldRel: string, newRel: string) => Promise<void>;
  deleteFolderEntry?: (relPath: string) => Promise<void>;
}

interface Window {
  electronAPI?: ElectronBridge;
}
