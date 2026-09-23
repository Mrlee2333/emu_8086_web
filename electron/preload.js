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
  openFolder: () => ipcRenderer.invoke(FOLDER_CHANNELS.openFolder),
  listFolder: (root) => ipcRenderer.invoke(FOLDER_CHANNELS.listFolder, root),
  readFolderFile: (root, relPath) =>
    ipcRenderer.invoke(FOLDER_CHANNELS.readFile, root, relPath),
  writeFolderFile: (root, relPath, content) =>
    ipcRenderer.invoke(FOLDER_CHANNELS.writeFile, root, relPath, content),
  createFolderEntry: (root, relPath, isDirectory) =>
    ipcRenderer.invoke(FOLDER_CHANNELS.createEntry, root, relPath, isDirectory),
  renameFolderEntry: (root, oldRel, newRel) =>
    ipcRenderer.invoke(FOLDER_CHANNELS.renameEntry, root, oldRel, newRel),
  deleteFolderEntry: (root, relPath) =>
    ipcRenderer.invoke(FOLDER_CHANNELS.deleteEntry, root, relPath),
});
