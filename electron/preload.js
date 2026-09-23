/**
 * Electron preload bridge (v1.3.0 offline desktop shell + v1.4.0 folder workspace).
 * Runs with context isolation: exposes a minimal read-only flag, a one-way
 * native-menu channel, and scoped folder-workspace invoke calls. No direct
 * Node APIs reach the renderer — all filesystem access is validated in main.
 */
const { contextBridge, ipcRenderer } = require("electron");

const MENU_CHANNEL = "emu8086web:menu";
const FOLDER_CHANNELS = {
  openFolder: "emu8086web:open-folder",
  getFolder: "emu8086web:get-folder",
  closeFolder: "emu8086web:close-folder",
  listFolder: "emu8086web:list-folder",
  readFile: "emu8086web:read-folder-file",
  writeFile: "emu8086web:write-folder-file",
  createEntry: "emu8086web:create-folder-entry",
  renameEntry: "emu8086web:rename-folder-entry",
  deleteEntry: "emu8086web:delete-folder-entry",
};

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: () => true,
  platform: process.platform,
  onMenuAction: (callback) => {
    const handler = (_event, action) => callback(action);
    ipcRenderer.on(MENU_CHANNEL, handler);
    return () => ipcRenderer.removeListener(MENU_CHANNEL, handler);
  },
  // Note: the allowed root lives in the main process (userData-persisted).
  // The renderer only sends paths relative to it — never absolute roots.
  openFolder: () =>
    ipcRenderer
      .invoke(FOLDER_CHANNELS.openFolder)
      .then((r) => (r ? { name: r.name } : null)),
  // Display name only — the absolute root never crosses to the renderer.
  getFolder: () =>
    ipcRenderer
      .invoke(FOLDER_CHANNELS.getFolder)
      .then((r) => (r ? { name: r.name } : null)),
  closeFolder: () => ipcRenderer.invoke(FOLDER_CHANNELS.closeFolder),
  listFolder: () => ipcRenderer.invoke(FOLDER_CHANNELS.listFolder),
  readFolderFile: (relPath) =>
    ipcRenderer.invoke(FOLDER_CHANNELS.readFile, relPath),
  writeFolderFile: (relPath, content) =>
    ipcRenderer.invoke(FOLDER_CHANNELS.writeFile, relPath, content),
  createFolderEntry: (relPath, isDirectory) =>
    ipcRenderer.invoke(FOLDER_CHANNELS.createEntry, relPath, isDirectory),
  renameFolderEntry: (oldRel, newRel) =>
    ipcRenderer.invoke(FOLDER_CHANNELS.renameEntry, oldRel, newRel),
  deleteFolderEntry: (relPath) =>
    ipcRenderer.invoke(FOLDER_CHANNELS.deleteEntry, relPath),
});
