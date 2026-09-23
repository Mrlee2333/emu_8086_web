"use client";

import { useState } from "react";
import { DialogShell } from "@/components/ide/dialog-shell";

export type DialogRequest =
  | {
      kind: "input";
      title: string;
      label?: string;
      initialValue?: string;
      placeholder?: string;
      confirmLabel?: string;
      /** Return an error message for invalid values, or null when valid. */
      validate?: (value: string) => string | null;
    }
  | {
      kind: "confirm";
      title: string;
      message: string;
      confirmLabel?: string;
      danger?: boolean;
    };

interface InputDialogHostProps {
  request: DialogRequest;
  onResolve: (value: string | boolean | null) => void;
}

/**
 * In-app replacement for window.prompt / window.confirm (v1.4.0 fix).
 * Native prompt() throws in Electron ("prompt() is not supported"), so all
 * name inputs and destructive confirms go through this modal instead.
 * The parent remounts per request (key), so useState init is sufficient.
 */
export function InputDialogHost({ request, onResolve }: InputDialogHostProps) {
  const [value, setValue] = useState(
    request.kind === "input" ? (request.initialValue ?? "") : "",
  );
  const [error, setError] = useState<string | null>(null);

  const close = (v: string | boolean | null) => onResolve(v);

  if (request.kind === "confirm") {
    return (
      <DialogShell
        open
        onClose={() => close(null)}
        title={request.title}
        panelClassName="max-w-sm"
      >
        <p className="text-sm text-ink">{request.message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="btn"
            autoFocus={request.danger === true}
            onClick={() => close(null)}
          >
            Cancel
          </button>
          <button
            type="button"
            autoFocus={request.danger !== true}
            className={`btn ${request.danger ? "btn-danger" : "btn-primary"}`}
            onClick={() => close(true)}
          >
            {request.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </DialogShell>
    );
  }

  const submit = () => {
    const trimmed = value.trim();
    if (request.validate) {
      const err = request.validate(trimmed);
      if (err) {
        setError(err);
        return;
      }
    }
    if (!trimmed) {
      setError("Name cannot be empty");
      return;
    }
    close(trimmed);
  };

  return (
    <DialogShell
      open
      onClose={() => close(null)}
      title={request.title}
      panelClassName="max-w-sm"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {request.label ? (
          <label
            htmlFor="emu-input-dialog"
            className="mb-1 block text-xs text-ink-dim"
          >
            {request.label}
          </label>
        ) : null}
        <input
          id="emu-input-dialog"
          autoFocus
          type="text"
          className="w-full rounded border border-line bg-bg px-2.5 py-2 font-mono text-sm text-ink outline-none focus:border-amber"
          value={value}
          placeholder={request.placeholder}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onFocus={(e) => e.target.select()}
          spellCheck={false}
          autoComplete="off"
        />
        {error ? (
          <p className="mt-1.5 text-xs text-red" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn" onClick={() => close(null)}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            {request.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}
