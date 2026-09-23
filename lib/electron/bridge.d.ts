/** Typing for the Electron preload bridge (offline desktop shell). */
interface ElectronFolderEntry {
  relPath: string;
  isDirectory: boolean;
}

interface ElectronBridge {
  isElectron: () => boolean;
  platform: NodeJS.Platform;
  onMenuAction?: (callback: (action: string) => void) => () => void;
  /** v1.4.0 folder workspace — present only inside the Electron shell. */
  openFolder?: () => Promise<{ root: string; name: string } | null>;
  listFolder?: (root: string) => Promise<ElectronFolderEntry[]>;
  readFolderFile?: (root: string, relPath: string) => Promise<string>;
  writeFolderFile?: (
    root: string,
    relPath: string,
    content: string,
  ) => Promise<void>;
  createFolderEntry?: (
    root: string,
    relPath: string,
    isDirectory: boolean,
  ) => Promise<void>;
  renameFolderEntry?: (
    root: string,
    oldRel: string,
    newRel: string,
  ) => Promise<void>;
  deleteFolderEntry?: (root: string, relPath: string) => Promise<void>;
}

interface Window {
  electronAPI?: ElectronBridge;
}
