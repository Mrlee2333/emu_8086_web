import type { ReactNode } from "react";

type IconProps = {
  className?: string;
};

export function IconUndo({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6.36 2.64L3 13" />
    </svg>
  );
}

export function IconRedo({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 7v6h-6" />
      <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6.36 2.64L21 13" />
    </svg>
  );
}

export function IconCopy({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

/** Official GitHub mark (Octocat silhouette simplified as Mark). */
export function IconGitHub({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

function ToolbarSvg({
  className = "h-3.5 w-3.5",
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function IconFolderOpen({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <ToolbarSvg className={className}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </ToolbarSvg>
  );
}

export function IconSave({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <ToolbarSvg className={className}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </ToolbarSvg>
  );
}

export function IconSaveAs({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <ToolbarSvg className={className}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <line x1="12" y1="3" x2="12" y2="8" />
    </ToolbarSvg>
  );
}

export function IconShare({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <ToolbarSvg className={className}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
      <line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
    </ToolbarSvg>
  );
}

export function IconCompile({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <ToolbarSvg className={className}>
      <path d="M14.7 6.3a4.5 4.5 0 0 0-6 6L3 18l3 3 5.7-5.7a4.5 4.5 0 0 0 6-6L14 13l-3-3 3.7-3.7z" />
    </ToolbarSvg>
  );
}

export function IconPlay({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <polygon points="6 3 20 12 6 21 6 3" />
    </svg>
  );
}

export function IconPause({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="5" y="4" width="5" height="16" rx="1" />
      <rect x="14" y="4" width="5" height="16" rx="1" />
    </svg>
  );
}

export function IconStepOver({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <ToolbarSvg className={className}>
      <polyline points="9 18 15 12 9 6" />
      <line x1="18" y1="5" x2="18" y2="19" />
    </ToolbarSvg>
  );
}

export function IconStepBack({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <ToolbarSvg className={className}>
      <polyline points="15 18 9 12 15 6" />
      <line x1="6" y1="5" x2="6" y2="19" />
    </ToolbarSvg>
  );
}

export function IconReset({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <ToolbarSvg className={className}>
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </ToolbarSvg>
  );
}

export function IconHelp({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <ToolbarSvg className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </ToolbarSvg>
  );
}

export function IconSun({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <ToolbarSvg className={className}>
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="4.9" y1="4.9" x2="7" y2="7" />
      <line x1="17" y1="17" x2="19.1" y2="19.1" />
      <line x1="2" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="22" y2="12" />
      <line x1="4.9" y1="19.1" x2="7" y2="17" />
      <line x1="17" y1="7" x2="19.1" y2="4.9" />
    </ToolbarSvg>
  );
}

export function IconMoon({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <ToolbarSvg className={className}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </ToolbarSvg>
  );
}

export function IconChevronDown({ className = "h-3 w-3" }: IconProps) {
  return (
    <ToolbarSvg className={className}>
      <polyline points="6 9 12 15 18 9" />
    </ToolbarSvg>
  );
}

/** VS Code-style explorer icons (v1.4.0 folder workspace). */
export function IconFilePlus({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <ToolbarSvg className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="18" x2="12" y2="12" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </ToolbarSvg>
  );
}

export function IconFolderPlus({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <ToolbarSvg className={className}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </ToolbarSvg>
  );
}

export function IconRefresh({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <ToolbarSvg className={className}>
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </ToolbarSvg>
  );
}

export function IconX({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <ToolbarSvg className={className}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </ToolbarSvg>
  );
}

export function IconPencil({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <ToolbarSvg className={className}>
      <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
    </ToolbarSvg>
  );
}

export function IconTrash({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <ToolbarSvg className={className}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </ToolbarSvg>
  );
}

export function IconDownload({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <ToolbarSvg className={className}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </ToolbarSvg>
  );
}

export function IconFile({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <ToolbarSvg className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </ToolbarSvg>
  );
}

export function IconFolder({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <ToolbarSvg className={className}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </ToolbarSvg>
  );
}

export function IconChevronRight({ className = "h-3 w-3" }: IconProps) {
  return (
    <ToolbarSvg className={className}>
      <polyline points="9 18 15 12 9 6" />
    </ToolbarSvg>
  );
}

export function IconChevronDownSm({ className = "h-3 w-3" }: IconProps) {
  return (
    <ToolbarSvg className={className}>
      <polyline points="6 9 12 15 18 9" />
    </ToolbarSvg>
  );
}

export function IconPanelLeft({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <ToolbarSvg className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </ToolbarSvg>
  );
}

export function IconSettings({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <ToolbarSvg className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </ToolbarSvg>
  );
}
