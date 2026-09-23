"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdSenseAnchor, AdSenseUnit, AD_SLOTS } from "@/components/ads/adsense-unit";
import { AluPanel } from "@/components/ide/alu-panel";
import { CodeEditor, type CodeEditorHandle } from "@/components/ide/code-editor";
import {
  ConsolePanel,
  FlagsPanel,
  RegisterPanel,
  StatusLine,
} from "@/components/ide/cpu-panels";
import {
  IconCopy,
  IconPanelLeftOpen,
  IconRedo,
  IconUndo,
} from "@/components/ide/editor-icons";
import { FileTabs } from "@/components/ide/file-tabs";
import { FolderExplorer } from "@/components/ide/folder-explorer";
import {
  InputDialogHost,
  type DialogRequest,
} from "@/components/ide/input-dialog";
import { OPEN_HELP_EVENT } from "@/components/ide/help-menu";
import {
  DataSegmentPanel,
  HexDumpPanel,
  StackPanels,
} from "@/components/ide/memory-panels";
import { ErrorBar, Toast } from "@/components/ide/overlays";
import { ResizeHandle } from "@/components/ide/resize-panels";
import { SettingsModal } from "@/components/ide/settings-modal";
import { ShareDialog } from "@/components/ide/share-dialog";
import { Toolbar } from "@/components/ide/toolbar";
import { WatchPanel } from "@/components/ide/watch-panel";
import { WebMcpBootstrap } from "@/components/ide/webmcp-bootstrap";
import { useEmulator } from "@/lib/ide/use-emulator";
import { isAdsEnabled } from "@/lib/adsense";
import { isElectronRenderer } from "@/lib/electron/offline";
import {
  applyAccent,
  FONT_SCALE_KEY,
  loadAccent,
  loadTabSize,
  loadWordWrap,
  TAB_SIZE_KEY,
  type TabSize,
  WORD_WRAP_KEY,
} from "@/lib/ide/editor-prefs";
import {
  createWebEntry,
  listWebFolder,
  pickWebFolder,
  readWebFile,
  supportsFolderPicker,
  writeWebFile,
  type WebDirHandle,
} from "@/lib/ide/fs-access";
import { createZip } from "@/lib/ide/zip";
import {
  buildTreeFromPaths,
  createExplorerRoot,
  createFileNode,
  createFolderNode,
  findNode,
  flattenVisible,
  isValidSegment,
  SIDEBAR_COLLAPSED_KEY,
  SIDEBAR_EXPANDED_KEY,
  type ExplorerRoot,
} from "@/lib/ide/workspace-folders";
import {
  createDefaultFile,
  createFileId,
  ELECTRON_ROOT_KEY,
  ensureAsmExtension,
  isOpenableSize,
  loadFilesFromStorage,
  MAX_OPEN_FILE_BYTES,
  sanitizeFileName,
  saveFilesToStorage,
  type WorkspaceFile,
} from "@/lib/ide/workspace-files";
import type { SampleKey } from "@/lib/emulator";
import { SAMPLES } from "@/lib/emulator";
import {
  clearShareQueryFromUrl,
  setMemoryShare,
  takeShareCodeFromUrl,
  takeSharedSourceFromUrl,
} from "@/lib/ide/share-boot";
import {
  loadOverrides,
  loadScheme,
  matchShortcut,
} from "@/lib/ide/shortcuts";

export function IdeWorkspace() {
  const [files, setFiles] = useState<WorkspaceFile[]>(() => [createDefaultFile()]);
  const [activeId, setActiveId] = useState(() => files[0]?.id ?? "");
  // Open editor tabs — VS Code semantics: closing a tab keeps the project file.
  const [openIds, setOpenIds] = useState<string[]>(() => [files[0]?.id ?? ""]);
  const [hydrated, setHydrated] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [leftPct, setLeftPct] = useState(58);
  const [editorPct, setEditorPct] = useState(58);
  const [cpuCollapsed, setCpuCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [tabSize, setTabSize] = useState<TabSize>(4);
  const [wordWrap, setWordWrap] = useState(false);
  // v1.4.0 folder workspace (VS Code-like explorer + collapsible sidebar).
  const [folderRoot, setFolderRoot] = useState<ExplorerRoot | null>(null);
  const [folderName, setFolderName] = useState("");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(
    null,
  );
  const electronRootRef = useRef<string | null>(null);
  const webDirRef = useRef<WebDirHandle | null>(null);
  const folderBackendRef = useRef<"electron" | "web" | null>(null);
  const folderPathByFileIdRef = useRef<Map<string, string>>(new Map());
  // In-app dialogs (window.prompt/confirm throw in Electron).
  const [dialog, setDialog] = useState<{
    req: DialogRequest;
    id: number;
  } | null>(null);
  const dialogResolveRef = useRef<
    ((value: string | boolean | null) => void) | null
  >(null);
  const dialogSeqRef = useRef(0);

  const resolveDialog = useCallback((value: string | boolean | null) => {
    dialogResolveRef.current?.(value);
    dialogResolveRef.current = null;
    setDialog(null);
  }, []);

  const askInput = useCallback(
    (req: Extract<DialogRequest, { kind: "input" }>) =>
      new Promise<string | null>((resolve) => {
        dialogResolveRef.current = (v) =>
          resolve(typeof v === "string" ? v : null);
        dialogSeqRef.current += 1;
        setDialog({ req, id: dialogSeqRef.current });
      }),
    [],
  );

  const askConfirm = useCallback(
    (req: Extract<DialogRequest, { kind: "confirm" }>) =>
      new Promise<boolean>((resolve) => {
        dialogResolveRef.current = (v) => resolve(v === true);
        dialogSeqRef.current += 1;
        setDialog({ req, id: dialogSeqRef.current });
      }),
    [],
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorWrapRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<CodeEditorHandle>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // openTabs mirrors openIds order (tabs); project files live in `files`.
  const openTabs = useMemo(
    () =>
      openIds
        .map((id) => files.find((f) => f.id === id))
        .filter((f): f is WorkspaceFile => f !== undefined),
    [files, openIds],
  );
  const active = useMemo(
    () =>
      openIds.includes(activeId)
        ? (files.find((f) => f.id === activeId) ?? null)
        : null,
    [files, activeId, openIds],
  );
  const hasFiles = files.length > 0;

  const emu = useEmulator(active?.content);

  const lastSynced = useRef<string | null>(null);
  useEffect(() => {
    if (!active) {
      lastSynced.current = null;
      return;
    }
    if (lastSynced.current === active.id) return;
    lastSynced.current = active.id;
    emu.setSource(active.content);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tab switch sync
  }, [active?.id]);

  useEffect(() => {
    const applyShared = (sharedSource: string) => {
      const file = createDefaultFile("shared.asm");
      file.content = sharedSource;
      setFiles([file]);
      setActiveId(file.id);
      setOpenIds([file.id]);
      lastSynced.current = file.id;
      emu.setSource(sharedSource);
      setMemoryShare(sharedSource);
      clearShareQueryFromUrl();
      setHydrated(true);
    };

    const sharedSource = takeSharedSourceFromUrl();
    if (sharedSource) {
      queueMicrotask(() => applyShared(sharedSource));
      return;
    }

    const shareCode = takeShareCodeFromUrl();
    if (shareCode) {
      const fromSession = sessionStorage.getItem(`emu8086web:share:${shareCode}`);
      if (fromSession) {
        sessionStorage.removeItem(`emu8086web:share:${shareCode}`);
        queueMicrotask(() => applyShared(fromSession));
        return;
      }
      void (async () => {
        try {
          const res = await fetch(`/api/share/${shareCode}`);
          const data = (await res.json()) as { source?: string };
          if (res.ok && data.source) {
            applyShared(data.source);
            return;
          }
        } catch {
          /* fall through to local storage */
        }
        clearShareQueryFromUrl();
        const stored = loadFilesFromStorage();
        if (stored) {
          setFiles(stored.files);
          setActiveId(stored.activeId);
          setOpenIds(
            stored.openIds ?? stored.files.map((f) => f.id),
          );
          lastSynced.current = null;
        }
        setHydrated(true);
        setToast("Shared program not found or expired");
      })();
      return;
    }

    const stored = loadFilesFromStorage();
    queueMicrotask(() => {
      if (stored) {
        setFiles(stored.files);
        setActiveId(stored.activeId);
        setOpenIds(stored.openIds ?? stored.files.map((f) => f.id));
        lastSynced.current = null;
      }
      setHydrated(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once on mount
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      setTabSize(loadTabSize());
      setWordWrap(loadWordWrap());
      const scale = localStorage.getItem(FONT_SCALE_KEY);
      if (scale) {
        document.documentElement.style.fontSize = `${Number(scale) || 100}%`;
      }
      applyAccent(loadAccent(), emu.theme);
      try {
        setSidebarCollapsed(
          localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1",
        );
        const raw = localStorage.getItem(SIDEBAR_EXPANDED_KEY);
        if (raw) setExpandedPaths(new Set(JSON.parse(raw) as string[]));
      } catch {
        /* sidebar prefs are best-effort */
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prefs once on mount
  }, []);

  // Restore the last Electron folder on launch (real FS outlives reloads).
  useEffect(() => {
    if (!isElectronRenderer()) return;
    let cancelled = false;
    void (async () => {
      try {
        const raw = localStorage.getItem(ELECTRON_ROOT_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as { root?: string; name?: string };
        if (!parsed.root || !window.electronAPI?.listFolder) return;
        const entries = await window.electronAPI.listFolder(parsed.root);
        if (cancelled) return;
        electronRootRef.current = parsed.root;
        folderBackendRef.current = "electron";
        const name = parsed.name || parsed.root.split("/").pop() || parsed.root;
        setFolderName(name);
        const tree = buildTreeFromPaths(entries ?? []);
        tree.name = name;
        setFolderRoot(tree);
      } catch {
        try {
          localStorage.removeItem(ELECTRON_ROOT_KEY);
        } catch {
          /* ignore */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    try {
      localStorage.setItem(
        SIDEBAR_EXPANDED_KEY,
        JSON.stringify([...expandedPaths].slice(0, 200)),
      );
    } catch {
      /* ignore */
    }
  }, [expandedPaths]);

  useEffect(() => {
    applyAccent(loadAccent(), emu.theme);
  }, [emu.theme]);

  useEffect(() => {
    if (!hydrated) return;
    saveFilesToStorage(files, activeId, openIds);
  }, [files, activeId, openIds, hydrated]);

  const persistTabSize = useCallback((size: TabSize) => {
    setTabSize(size);
    localStorage.setItem(TAB_SIZE_KEY, String(size));
  }, []);

  const persistWordWrap = useCallback((wrap: boolean) => {
    setWordWrap(wrap);
    localStorage.setItem(WORD_WRAP_KEY, wrap ? "1" : "0");
  }, []);

  const { machine, assembled, tick } = emu;
  void tick;

  const currentLine = machine?.getCurrentLine() ?? null;
  const runtimeError = machine?.err ?? null;
  const errorMessage =
    emu.assemblyError != null
      ? `Assembly error — ${emu.assemblyError}`
      : runtimeError
        ? `Runtime error — ${runtimeError}`
        : null;
  const errorLine =
    emu.assemblyErrorLine ?? machine?.getErrorLine() ?? null;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  /* ---- v1.4.0 folder workspace ---- */

  const refreshFolder = useCallback(async () => {
    const backend = folderBackendRef.current;
    try {
      if (backend === "electron" && electronRootRef.current) {
        const entries = await window.electronAPI?.listFolder?.(
          electronRootRef.current,
        );
        const root = buildTreeFromPaths(entries ?? []);
        root.name = folderName;
        setFolderRoot(root);
        return;
      }
      if (backend === "web" && webDirRef.current) {
        const entries = await listWebFolder(webDirRef.current);
        const root = buildTreeFromPaths(entries);
        root.name = folderName;
        setFolderRoot(root);
      }
    } catch {
      showToast("Refresh failed");
    }
  }, [folderName, showToast]);

  const openFolder = useCallback(async () => {
    // Electron desktop first (real filesystem via preload bridge).
    try {
      const picked = await window.electronAPI?.openFolder?.();
      if (picked) {
        electronRootRef.current = picked.root;
        webDirRef.current = null;
        folderBackendRef.current = "electron";
        setFolderName(picked.name);
        const entries = await window.electronAPI?.listFolder?.(picked.root);
        const root = buildTreeFromPaths(entries ?? []);
        root.name = picked.name;
        setFolderRoot(root);
        setSelectedFolderPath(null);
        setSidebarCollapsed(false);
        try {
          localStorage.setItem(
            ELECTRON_ROOT_KEY,
            JSON.stringify({ root: picked.root, name: picked.name }),
          );
        } catch {
          /* best-effort */
        }
        showToast(`Opened folder ${picked.name}`);
        return;
      }
    } catch {
      showToast("Open folder failed");
      return;
    }
    // Web fallback: File System Access API (Chromium).
    if (!supportsFolderPicker()) {
      showToast("Folder open needs the desktop app or Chrome/Edge");
      return;
    }
    const dir = await pickWebFolder();
    if (!dir) return;
    webDirRef.current = dir;
    electronRootRef.current = null;
    folderBackendRef.current = "web";
    setFolderName(dir.name);
    const entries = await listWebFolder(dir);
    const root = buildTreeFromPaths(entries);
    root.name = dir.name;
    setFolderRoot(root);
    setSelectedFolderPath(null);
    setSidebarCollapsed(false);
    showToast(`Opened folder ${dir.name}`);
  }, [showToast]);

  const closeFolder = useCallback(() => {
    setFolderRoot(null);
    setFolderName("");
    setSelectedFolderPath(null);
    electronRootRef.current = null;
    webDirRef.current = null;
    folderBackendRef.current = null;
    folderPathByFileIdRef.current.clear();
    try {
      localStorage.removeItem(ELECTRON_ROOT_KEY);
    } catch {
      /* best-effort */
    }
  }, []);

  const toggleFolder = useCallback((relPath: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
  }, []);

  const openFolderFile = useCallback(
    async (relPath: string) => {
      const backend = folderBackendRef.current;
      if (!backend) return;
      // Already open as a tab? Select it (inline — selectFile is declared below).
      for (const f of files) {
        if (folderPathByFileIdRef.current.get(f.id) === relPath) {
          const id = f.id;
          setOpenIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
          setFiles((prev) => {
            const flushed = prev.map((item) =>
              item.id === activeId ? { ...item, content: emu.source } : item,
            );
            const next = flushed.find((item) => item.id === id);
            if (next) queueMicrotask(() => emu.setSource(next.content));
            return flushed;
          });
          setActiveId(id);
          lastSynced.current = id;
          setSelectedFolderPath(relPath);
          return;
        }
      }
      try {
        let content = "";
        if (backend === "electron" && electronRootRef.current) {
          content =
            (await window.electronAPI?.readFolderFile?.(
              electronRootRef.current,
              relPath,
            )) ?? "";
        } else if (backend === "web" && webDirRef.current) {
          content = await readWebFile(webDirRef.current, relPath);
        }
        const base = relPath.split("/").pop() ?? relPath;
        const file: WorkspaceFile = {
          id: createFileId(),
          name: ensureAsmExtension(base),
          content,
          dirty: false,
        };
        setFiles((prev) => {
          const flushed = prev.map((f) =>
            f.id === activeId ? { ...f, content: emu.source } : f,
          );
          return [...flushed, file];
        });
        folderPathByFileIdRef.current.set(file.id, relPath);
        setOpenIds((prev) => [...prev, file.id]);
        setActiveId(file.id);
        setSelectedFolderPath(relPath);
        lastSynced.current = null;
        queueMicrotask(() => emu.setSource(content));
      } catch {
        showToast("Could not open that file");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- files/active snapshot per open
    [files, activeId, emu.source, showToast],
  );

  const createInFolder = useCallback(
    async (parentPath: string, isDirectory: boolean) => {
      const backend = folderBackendRef.current;
      if (!backend) {
        showToast("Open a folder first");
        return;
      }
      const raw = await askInput({
        kind: "input",
        title: isDirectory ? "New folder" : "New file",
        label: isDirectory ? "Folder name" : "File name",
        initialValue: isDirectory ? "examples" : "program.asm",
        confirmLabel: "Create",
        validate: (v) => {
          if (!v) return "Name cannot be empty";
          if (!isValidSegment(v)) return "Invalid name";
          return null;
        },
      });
      if (!raw) return;
      try {
        let rel = "";
        if (isDirectory) {
          const node = createFolderNode({ name: raw, parentPath });
          rel = node.relPath;
        } else {
          const node = createFileNode({
            name: ensureAsmExtension(raw),
            parentPath,
          });
          rel = node.relPath;
        }
        if (backend === "electron" && electronRootRef.current) {
          await window.electronAPI?.createFolderEntry?.(
            electronRootRef.current,
            rel,
            isDirectory,
          );
          if (!isDirectory) {
            await window.electronAPI?.writeFolderFile?.(
              electronRootRef.current,
              rel,
              `; ${rel}\n.model small\n.stack 100h\n.data\n.code\nmain proc\n    mov ah, 4ch\n    int 21h\nmain endp\nend main\n`,
            );
          }
        } else if (backend === "web" && webDirRef.current) {
          await createWebEntry(webDirRef.current, rel, isDirectory);
          if (!isDirectory) {
            await writeWebFile(
              webDirRef.current,
              rel,
              `; ${rel}\n.model small\n.stack 100h\n.data\n.code\nmain proc\n    mov ah, 4ch\n    int 21h\nmain endp\nend main\n`,
            );
          }
        }
        await refreshFolder();
        setExpandedPaths((prev) =>
          parentPath ? new Set(prev).add(parentPath) : prev,
        );
        if (!isDirectory) await openFolderFile(rel);
        else showToast(`Created ${rel}`);
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Create failed");
      }
    },
    [refreshFolder, openFolderFile, showToast, askInput],
  );

  const renameInFolder = useCallback(
    async (relPath: string) => {
      const backend = folderBackendRef.current;
      if (!backend) return;
      const node = findNode({
        root: folderRoot ?? createExplorerRoot(),
        relPath,
      });
      if (!node || node.kind === undefined) {
        showToast("Path not found");
        return;
      }
      const isFile = node.kind === "file";
      const newName = await askInput({
        kind: "input",
        title: isFile ? "Rename file" : "Rename folder",
        label: "New name",
        initialValue: node.name,
        confirmLabel: "Rename",
        validate: (v) => {
          if (!v) return "Name cannot be empty";
          if (!isValidSegment(v)) return "Invalid name";
          return null;
        },
      });
      if (!newName || newName === node.name) return;
      try {
        const parent = relPath.includes("/")
          ? relPath.slice(0, relPath.lastIndexOf("/"))
          : "";
        const clean =
          findNode({ root: folderRoot ?? createExplorerRoot(), relPath })
            ?.kind === "file"
            ? ensureAsmExtension(newName)
            : sanitizeFileName(newName);
        const base = parent ? `${parent}/${clean}` : clean;
        if (backend === "electron" && electronRootRef.current) {
          await window.electronAPI?.renameFolderEntry?.(
            electronRootRef.current,
            relPath,
            base,
          );
        } else if (backend === "web" && webDirRef.current) {
          // Web rename = create + delete (FS Access has no rename).
          const node = findNode({
            root: folderRoot ?? createExplorerRoot(),
            relPath,
          });
          if (!node) throw new Error("Path not found");
          if (node.kind === "file") {
            const content = await readWebFile(webDirRef.current, relPath);
            await createWebEntry(webDirRef.current, base, false);
            await writeWebFile(webDirRef.current, base, content);
          } else {
            await createWebEntry(webDirRef.current, base, true);
          }
          const parts = relPath.split("/").filter(Boolean);
          const leaf = parts.pop() ?? "";
          let parentHandle = webDirRef.current;
          for (const part of parts) {
            parentHandle = await parentHandle.getDirectoryHandle(part);
          }
          await parentHandle.removeEntry(leaf, { recursive: true });
        }
        // Move any open tab mapping.
        for (const [id, p] of folderPathByFileIdRef.current) {
          if (p === relPath || p.startsWith(`${relPath}/`)) {
            folderPathByFileIdRef.current.set(
              id,
              base + p.slice(relPath.length),
            );
          }
        }
        await refreshFolder();
        showToast(`Renamed to ${clean}`);
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Rename failed");
      }
    },
    [folderRoot, refreshFolder, showToast, askInput],
  );

  const deleteInFolder = useCallback(
    async (relPath: string) => {
      const backend = folderBackendRef.current;
      if (!backend) return;
      const ok = await askConfirm({
        kind: "confirm",
        title: "Delete",
        message: `Delete ${relPath}? This cannot be undone.`,
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      try {
        if (backend === "electron" && electronRootRef.current) {
          await window.electronAPI?.deleteFolderEntry?.(
            electronRootRef.current,
            relPath,
          );
        } else if (backend === "web" && webDirRef.current) {
          const parts = relPath.split("/").filter(Boolean);
          const leaf = parts.pop() ?? "";
          let current = webDirRef.current;
          for (const part of parts) {
            current = await current.getDirectoryHandle(part);
          }
          await current.removeEntry(leaf, { recursive: true });
        }
        for (const [id, p] of [...folderPathByFileIdRef.current]) {
          if (p === relPath || p.startsWith(`${relPath}/`)) {
            folderPathByFileIdRef.current.delete(id);
          }
        }
        await refreshFolder();
        showToast(`Deleted ${relPath}`);
      } catch {
        showToast("Delete failed");
      }
    },
    [refreshFolder, showToast, askConfirm],
  );

  const updateActiveContent = (content: string) => {
    if (!activeId) return;
    emu.setSource(content);
    setFiles((prev) =>
      prev.map((f) =>
        f.id === activeId ? { ...f, content, dirty: true } : f,
      ),
    );
  };

  const selectFile = (id: string) => {
    setOpenIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setFiles((prev) => {
      const flushed = prev.map((f) =>
        f.id === activeId ? { ...f, content: emu.source } : f,
      );
      const next = flushed.find((f) => f.id === id);
      if (next) queueMicrotask(() => emu.setSource(next.content));
      return flushed;
    });
    setActiveId(id);
    lastSynced.current = id;
  };

  const newFile = async (suggestedName?: string) => {
    const raw = await askInput({
      kind: "input",
      title: "New file",
      label: "File name",
      initialValue: suggestedName ?? `untitled${files.length + 1}.asm`,
      confirmLabel: "Create",
      validate: (v) => {
        if (!v) return "Name cannot be empty";
        if (!isValidSegment(v)) return "Invalid file name";
        return null;
      },
    });
    if (!raw) return;
    const name = ensureAsmExtension(raw);
    const file = createDefaultFile(name);
    file.content = `; ${name}\n.model small\n.stack 100h\n.data\n.code\nmain proc\n    mov ah, 4ch\n    int 21h\nmain endp\nend main\n`;
    setFiles((prev) => {
      const flushed = prev.map((f) =>
        f.id === activeId ? { ...f, content: emu.source } : f,
      );
      return [...flushed, file];
    });
    setOpenIds((prev) => [...prev, file.id]);
    setActiveId(file.id);
    lastSynced.current = null;
  };

  /**
   * Close an editor tab (VS Code semantics) — the project file stays in
   * the Explorer. Disk-backed tabs drop their folder mapping.
   */
  const closeTab = (id: string) => {
    folderPathByFileIdRef.current.delete(id);
    const tabs = openIds.includes(id)
      ? openIds.filter((t) => t !== id)
      : openIds;
    setOpenIds(tabs);
    if (activeId !== id) return;
    const fallback = tabs[Math.max(0, openIds.indexOf(id) - 1)] ?? "";
    setActiveId(fallback);
    lastSynced.current = null;
    if (!fallback) emu.setSource("");
  };

  const renameFile = async (id: string) => {
    const current = files.find((f) => f.id === id);
    if (!current) return;
    const raw = await askInput({
      kind: "input",
      title: "Rename file",
      label: "File name",
      initialValue: current.name,
      confirmLabel: "Rename",
      validate: (v) => {
        if (!v) return "Name cannot be empty";
        if (!isValidSegment(v)) return "Invalid file name";
        return null;
      },
    });
    if (!raw) return;
    const name = ensureAsmExtension(raw);
    setFiles((prev) =>
      prev.map((f) =>
        f.id === id ? { ...f, name, dirty: true } : f,
      ),
    );
  };

  /** Delete a file from the project itself (Explorer trash). */
  const deleteVirtualFile = async (id: string) => {
    const target = files.find((f) => f.id === id);
    const ok = await askConfirm({
      kind: "confirm",
      title: "Delete file",
      message: `Delete ${target?.name ?? "this file"} from the project? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    closeTab(id);
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleOpen = () => fileInputRef.current?.click();

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list?.length) return;
    const picked = Array.from(list);
    const skipped = picked.filter((f) => !isOpenableSize(f.size));
    const accepted = picked.filter((f) => isOpenableSize(f.size));
    if (skipped.length > 0) {
      showToast(
        `Skipped ${skipped.length} file(s) over ${Math.round(MAX_OPEN_FILE_BYTES / 1024)} KiB: ${skipped
          .slice(0, 3)
          .map((f) => f.name)
          .join(", ")}${skipped.length > 3 ? "…" : ""}`,
      );
    }
    if (accepted.length === 0) {
      e.target.value = "";
      return;
    }
    const readers = accepted.map(
      (file) =>
        new Promise<WorkspaceFile>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            resolve({
              id: createFileId(),
              name: ensureAsmExtension(file.name),
              content: String(reader.result),
              dirty: false,
            });
          };
          reader.readAsText(file);
        }),
    );
    void Promise.all(readers).then((opened) => {
      setFiles((prev) => {
        const flushed = prev.map((f) =>
          f.id === activeId ? { ...f, content: emu.source } : f,
        );
        return [...flushed, ...opened];
      });
      setOpenIds((prev) => [
        ...prev,
        ...opened.map((f) => f.id).filter((id) => !prev.includes(id)),
      ]);
      setActiveId(opened[opened.length - 1].id);
      lastSynced.current = null;
      showToast(`Opened ${opened.length} file(s)`);
    });
    e.target.value = "";
  };

  const downloadFile = (name: string, content: string) => {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = ensureAsmExtension(name);
    a.click();
    URL.revokeObjectURL(url);
  };

  /** Overleaf-style project export: the whole project as one .zip. */
  const exportProject = () => {
    const snapshot = files.map((f) =>
      f.id === activeId ? { ...f, content: emu.source } : f,
    );
    if (snapshot.length === 0) {
      showToast("Nothing to export");
      return;
    }
    try {
      const bytes = createZip(
        snapshot.map((f) => ({
          name: `emu8086-project/${ensureAsmExtension(f.name)}`,
          content: f.content,
        })),
      );
      const blob = new Blob([bytes.buffer as ArrayBuffer], {
        type: "application/zip",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "emu8086-project.zip";
      a.click();
      URL.revokeObjectURL(url);
      showToast(`Exported ${snapshot.length} file(s) as .zip`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Export failed");
    }
  };

  const handleSave = () => {
    if (!active) {
      showToast("No file open");
      return;
    }
    // Folder-backed files save straight back to disk (Electron / FS Access).
    const folderRel = folderPathByFileIdRef.current.get(activeId);
    const backend = folderBackendRef.current;
    if (folderRel && backend === "electron" && electronRootRef.current) {
      const root = electronRootRef.current;
      void window.electronAPI
        ?.writeFolderFile?.(root, folderRel, emu.source)
        .then(
          () => {
            setFiles((prev) =>
              prev.map((f) =>
                f.id === activeId
                  ? { ...f, content: emu.source, dirty: false }
                  : f,
              ),
            );
            showToast(`Saved ${folderRel}`);
          },
          () => showToast("Save to folder failed"),
        );
      return;
    }
    if (folderRel && backend === "web" && webDirRef.current) {
      const dir = webDirRef.current;
      void writeWebFile(dir, folderRel, emu.source).then(
        () => {
          setFiles((prev) =>
            prev.map((f) =>
              f.id === activeId
                ? { ...f, content: emu.source, dirty: false }
                : f,
            ),
          );
          showToast(`Saved ${folderRel}`);
        },
        () => showToast("Save to folder failed"),
      );
      return;
    }
    downloadFile(active.name, emu.source);
    setFiles((prev) =>
      prev.map((f) =>
        f.id === activeId ? { ...f, content: emu.source, dirty: false } : f,
      ),
    );
    showToast(`Saved ${active.name}`);
  };

  const handleSaveAs = async () => {
    if (!active) {
      showToast("No file open");
      return;
    }
    const name = await askInput({
      kind: "input",
      title: "Save as",
      label: "File name",
      initialValue: active.name,
      confirmLabel: "Save",
      validate: (v) => {
        if (!v) return "Name cannot be empty";
        if (!isValidSegment(v)) return "Invalid file name";
        return null;
      },
    });
    if (!name) return;
    const finalName = ensureAsmExtension(name);
    downloadFile(finalName, emu.source);
    setFiles((prev) =>
      prev.map((f) =>
        f.id === activeId
          ? { ...f, name: finalName, content: emu.source, dirty: false }
          : f,
      ),
    );
    showToast(`Saved ${finalName}`);
  };

  const handleShare = () => {
    if (!active) {
      showToast("Open or create a file first");
      return;
    }
    setShareOpen(true);
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(emu.source);
      showToast("Code copied");
    } catch {
      showToast("Copy failed");
    }
  };

  const handleCopyConsole = async () => {
    try {
      await navigator.clipboard.writeText(machine?.output ?? "");
      showToast("Console copied");
    } catch {
      showToast("Copy failed");
    }
  };

  const loadSample = (key: SampleKey) => {
    if (!active) {
      const file = createDefaultFile("main.asm");
      file.content = SAMPLES[key];
      setFiles([file]);
      setActiveId(file.id);
      setOpenIds([file.id]);
      lastSynced.current = null;
    } else {
      updateActiveContent(SAMPLES[key]);
    }
    showToast(`Loaded sample: ${key}`);
  };

  // Native desktop menu (Electron shell) → IDE actions.
  // Action ids match electron/menu.js MENU_CHANNEL payloads.
  // Runs every render so folder open/close closures stay fresh.
  const menuHandlers = useRef<Record<string, () => void>>({});
  useEffect(() => {
    menuHandlers.current = {
      "file:new": () => void newFile(),
      "file:open": () => handleOpen(),
      "file:open-folder": () => void openFolder(),
      "file:close-folder": () => closeFolder(),
      "file:save": () => handleSave(),
      "file:save-as": () => handleSaveAs(),
      "emu:assemble": () => {
        if (active) emu.doAssemble();
      },
      "emu:run": () => emu.doRun(),
      "emu:pause": () => emu.doPause(),
      "emu:step": () => emu.doStep(),
      "emu:step-back": () => emu.doStepBack(),
      "emu:reset": () => emu.doReset(),
      "help:shortcuts": () =>
        window.dispatchEvent(
          new CustomEvent(OPEN_HELP_EVENT, { detail: { panel: "shortcuts" } }),
        ),
      "help:ascii": () =>
        window.dispatchEvent(
          new CustomEvent(OPEN_HELP_EVENT, { detail: { panel: "ascii" } }),
        ),
      "help:convert": () =>
        window.dispatchEvent(
          new CustomEvent(OPEN_HELP_EVENT, { detail: { panel: "convert" } }),
        ),
    };
  });

  useEffect(() => {
    const off = window.electronAPI?.onMenuAction?.((action) => {
      menuHandlers.current[action]?.();
    });
    return off;
  }, []);

  const jumpToError = useCallback(() => {
    if (!errorLine || !editorWrapRef.current) return;
    const ta = editorWrapRef.current.querySelector("textarea");
    if (!ta) return;
    const lines = emu.source.split("\n");
    let pos = 0;
    for (let i = 0; i < errorLine - 1 && i < lines.length; i++) {
      pos += lines[i].length + 1;
    }
    const lineLen = lines[errorLine - 1]?.length ?? 0;
    ta.focus();
    ta.setSelectionRange(pos, pos + lineLen);
    ta.scrollTop = Math.max(0, (errorLine - 1) * 20 - 80);
  }, [errorLine, emu.source]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const scheme = loadScheme();
      const overrides = loadOverrides();
      const hit = (id: Parameters<typeof matchShortcut>[1]) =>
        matchShortcut(e, id, scheme, overrides);

      if (hit("save")) {
        e.preventDefault();
        handleSave();
        return;
      }

      if (
        hit("shortcuts") ||
        (e.key === "?" &&
          !e.ctrlKey &&
          !e.metaKey &&
          !(e.target instanceof HTMLTextAreaElement) &&
          !(e.target instanceof HTMLInputElement))
      ) {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent(OPEN_HELP_EVENT, {
            detail: { panel: "shortcuts" },
          }),
        );
        return;
      }

      if (hit("ascii")) {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent(OPEN_HELP_EVENT, {
            detail: { panel: "ascii" },
          }),
        );
        return;
      }

      if (hit("convert")) {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent(OPEN_HELP_EVENT, {
            detail: { panel: "convert" },
          }),
        );
        return;
      }

      if (hit("assemble")) {
        e.preventDefault();
        if (active) emu.doAssemble();
        return;
      }
      if (hit("stepBack")) {
        e.preventDefault();
        emu.doStepBack();
        return;
      }
      if (hit("step")) {
        e.preventDefault();
        emu.doStep();
        return;
      }

      const inField =
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLInputElement;

      if (inField) return;

      if (e.key === "Escape" && !settingsOpen) {
        const openDialog = document.querySelector(
          '[role="dialog"][aria-modal="true"]',
        );
        if (openDialog) return;
        e.preventDefault();
        emu.doPause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onHorizontalDrag = useCallback((delta: number) => {
    const width = splitRef.current?.clientWidth ?? window.innerWidth;
    setLeftPct((p) => Math.min(78, Math.max(28, p + (delta / width) * 100)));
  }, []);

  const onVerticalDrag = useCallback((delta: number) => {
    const col = editorWrapRef.current?.parentElement;
    const height = col?.clientHeight ?? 400;
    setEditorPct((p) => Math.min(82, Math.max(22, p + (delta / height) * 100)));
  }, []);

  const folderRows = useMemo(
    () =>
      folderRoot
        ? flattenVisible({ root: folderRoot, expanded: expandedPaths })
        : [],
    [folderRoot, expandedPaths],
  );

  useEffect(() => {
    const onGet = () => {
      window.dispatchEvent(
        new CustomEvent("emu8086web:webmcp-source", {
          detail: { source: emu.source },
        }),
      );
    };
    const onSet = (e: Event) => {
      const source = (e as CustomEvent<{ source?: string }>).detail?.source;
      if (typeof source !== "string") return;
      updateActiveContent(source);
    };
    window.addEventListener("emu8086web:webmcp-get-source", onGet);
    window.addEventListener("emu8086web:webmcp-set-source", onSet);
    return () => {
      window.removeEventListener("emu8086web:webmcp-get-source", onGet);
      window.removeEventListener("emu8086web:webmcp-set-source", onSet);
    };
  });

  // Electron is filesystem-first: empty state invites opening a real
  // folder instead of the virtual browser project. Plain browsers get the
  // Overleaf-like virtual project.
  const isElectronShell = useMemo(() => isElectronRenderer(), []);
  const collapseSidebar = useCallback(() => setSidebarCollapsed(true), []);
  const expandSidebar = useCallback(() => setSidebarCollapsed(false), []);

  const explorer = !sidebarCollapsed ? (
    <div className="max-h-44 min-h-0 shrink-0 overflow-hidden border-b border-line bg-panel lg:max-h-none lg:w-60 lg:border-r lg:border-b-0">
      {folderRoot ? (
        <FolderExplorer
          mode="disk"
          rootName={folderName}
          rows={folderRows}
          expanded={expandedPaths}
          selectedPath={selectedFolderPath}
          onToggleFolder={toggleFolder}
          onOpenFile={(rel) => void openFolderFile(rel)}
          onNewFile={(parent) => void createInFolder(parent, false)}
          onNewFolder={(parent) => void createInFolder(parent, true)}
          onRename={(rel) => void renameInFolder(rel)}
          onDelete={(rel) => void deleteInFolder(rel)}
          onRefresh={() => void refreshFolder()}
          onCloseFolder={closeFolder}
          onCollapse={collapseSidebar}
        />
      ) : isElectronShell ? (
        <FolderExplorer
          mode="empty"
          onOpenFolder={() => void openFolder()}
          onCollapse={collapseSidebar}
        />
      ) : (
        <FolderExplorer
          mode="virtual"
          files={files}
          activeId={activeId}
          onSelect={selectFile}
          onNewFile={() => void newFile()}
          onRename={(id) => void renameFile(id)}
          onDelete={(id) => void deleteVirtualFile(id)}
          onExport={() => void exportProject()}
          onOpenFolder={() => void openFolder()}
          onCollapse={collapseSidebar}
        />
      )}
    </div>
  ) : null;

  return (
    <div
      className="grid h-dvh max-h-dvh grid-rows-[auto_1fr] overflow-hidden bg-bg"
      style={{ paddingBottom: "var(--ad-anchor-pad, 0px)" }}
    >
      <WebMcpBootstrap />
      <input
        ref={fileInputRef}
        type="file"
        accept=".asm,.txt,.inc,text/plain"
        className="hidden"
        multiple
        onChange={handleFile}
      />

      <Toolbar
        runState={emu.runState}
        canRun={!!active && !!machine && !machine.halted}
        isRunning={emu.runState === "running"}
        canStepBack={emu.canStepBack}
        runSpeed={emu.runSpeed}
        theme={emu.theme}
        fileName={active?.name ?? ""}
        onAssemble={() => {
          if (!active) {
            showToast("Open or create a file first");
            return;
          }
          emu.doAssemble();
        }}
        onRun={emu.doRun}
        onPause={emu.doPause}
        onStep={emu.doStep}
        onStepBack={emu.doStepBack}
        onReset={emu.doReset}
        onSample={loadSample}
        onOpen={handleOpen}
        onSave={handleSave}
        onSaveAs={handleSaveAs}
        onShare={handleShare}
        onToggleTheme={() =>
          emu.applyTheme(emu.theme === "dark" ? "light" : "dark")
        }
        onSpeedChange={emu.setRunSpeed}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div
        ref={splitRef}
        className="flex min-h-0 flex-col overflow-hidden lg:flex-row"
      >
        {explorer}
        {sidebarCollapsed ? (
          <button
            type="button"
            className="flex shrink-0 items-start justify-center border-b border-line bg-panel p-1.5 text-ink-dim hover:text-amber lg:w-9 lg:border-r lg:border-b-0 lg:pt-2"
            title="Show Explorer"
            aria-label="Show Explorer"
            aria-expanded={false}
            data-tip="Show Explorer"
            onClick={expandSidebar}
          >
            <IconPanelLeftOpen className="h-4 w-4" />
          </button>
        ) : null}
        <div
          className="flex min-h-0 min-w-0 flex-col bg-bg"
          style={{
            flex: `0 0 ${leftPct}%`,
            maxWidth: "100%",
          }}
        >
          {!active ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-bg px-6 text-center">
              <p className="font-mono text-lg text-amber">No file open</p>
              <p className="max-w-sm text-sm text-ink-dim">
                {hasFiles
                  ? "Pick a file from the Explorer to start editing — closing a tab never deletes the project file."
                  : "Create a new assembly file or open an existing `.asm` to start coding."}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void newFile()}
                >
                  New file
                </button>
                <button type="button" className="btn" onClick={handleOpen}>
                  Open file…
                </button>
              </div>
            </div>
          ) : (
            <>
              <FileTabs
                files={openTabs}
                activeId={activeId}
                onSelect={selectFile}
                onClose={closeTab}
                onNew={() => void newFile()}
                onRename={(id) => void renameFile(id)}
              />
              <div
                ref={editorWrapRef}
                className="flex min-h-0 flex-col overflow-hidden"
                style={{ flex: `0 0 ${editorPct}%` }}
              >
              <div className="paneltitle flex shrink-0 items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 truncate">
                  <span className="truncate">
                    Source —{" "}
                    <span className="text-amber">{active?.name ?? "CODE.ASM"}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      className="btn btn-icon !px-1.5 !py-1 disabled:opacity-40"
                      onClick={() => editorRef.current?.undo()}
                      disabled={!canUndo}
                      title="Undo"
                      aria-label="Undo"
                    >
                      <IconUndo />
                    </button>
                    <button
                      type="button"
                      className="btn btn-icon !px-1.5 !py-1 disabled:opacity-40"
                      onClick={() => editorRef.current?.redo()}
                      disabled={!canRedo}
                      title="Redo"
                      aria-label="Redo"
                    >
                      <IconRedo />
                    </button>
                    <button
                      type="button"
                      className="btn btn-icon !px-1.5 !py-1"
                      onClick={handleCopyCode}
                      title="Copy source code"
                      aria-label="Copy source code"
                    >
                      <IconCopy />
                    </button>
                  </span>
                </span>
                <button
                  type="button"
                  className="shrink-0 text-[10px] text-ink-dim hover:text-amber lg:hidden"
                  onClick={() => setCpuCollapsed((c) => !c)}
                >
                  {cpuCollapsed ? "Show CPU" : "Hide CPU"}
                </button>
              </div>
              <CodeEditor
                ref={editorRef}
                source={emu.source}
                onChange={updateActiveContent}
                currentLine={currentLine}
                breakpoints={emu.breakpoints}
                onToggleBreakpoint={emu.toggleBreakpoint}
                errorLine={errorLine}
                errorMessage={errorMessage}
                tabSize={tabSize}
                wordWrap={wordWrap}
                onHistoryChange={({ canUndo: u, canRedo: r }) => {
                  setCanUndo(u);
                  setCanRedo(r);
                }}
              />
              <ErrorBar
                message={errorMessage}
                onJump={errorLine ? jumpToError : undefined}
                source={emu.source}
                errorLine={errorLine}
              />
            </div>

            <ResizeHandle direction="vertical" onDrag={onVerticalDrag} />

            <div className="mt-1 flex min-h-[120px] flex-1 flex-col overflow-hidden border-t border-line/40 pt-1">
              <ConsolePanel
                machine={machine}
                waitingForInput={machine?.waitingForInput ?? false}
                onInput={emu.provideInput}
                onCopy={handleCopyConsole}
                theme={emu.theme}
              />
            </div>
            </>
          )}
        </div>

        <div className="hidden lg:flex">
          <ResizeHandle direction="horizontal" onDrag={onHorizontalDrag} />
        </div>

          <div
            className={`min-h-0 min-w-0 overflow-auto bg-bg ${
              cpuCollapsed
                ? "hidden lg:block"
                : "block max-h-[42vh] lg:max-h-none"
            }`}
            style={{ flex: "1 1 auto" }}
          >
            <RegisterPanel machine={machine} />
            <FlagsPanel machine={machine} />
            <AluPanel machine={machine} />
            <StatusLine machine={machine} />
            <WatchPanel machine={machine} />
            <DataSegmentPanel
              assembled={assembled}
              machine={machine}
              hexBase={emu.hexBase}
              onHexBaseChange={emu.setHexBase}
            />
            <HexDumpPanel
              assembled={assembled}
              machine={machine}
              hexBase={emu.hexBase}
              onHexBaseChange={emu.setHexBase}
            />
            <StackPanels machine={machine} />
            {isAdsEnabled() ? (
              <div className="mt-2 hidden border-t border-line px-2 py-2 lg:block">
                <AdSenseUnit slot={AD_SLOTS.banner2} compact />
              </div>
            ) : null}
          </div>
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={emu.theme}
        onThemeChange={emu.applyTheme}
        tabSize={tabSize}
        onTabSizeChange={persistTabSize}
        wordWrap={wordWrap}
        onWordWrapChange={persistWordWrap}
      />
      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        source={emu.source}
        onToast={showToast}
      />
      {dialog ? (
        <InputDialogHost
          key={dialog.id}
          request={dialog.req}
          onResolve={resolveDialog}
        />
      ) : null}
      {isAdsEnabled() ? <AdSenseAnchor slot={AD_SLOTS.banner1} /> : null}
      <Toast message={toast} />
    </div>
  );
}
