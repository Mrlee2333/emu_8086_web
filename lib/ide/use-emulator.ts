"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  assemble,
  AUTOSAVE_KEY,
  createMachine,
  DEFAULT_SOURCE,
  encodeProgramToShare,
  INSTRUCTION_LIMIT,
  type AssembledProgram,
  type FullMachineState,
  type RunState,
  type SampleKey,
  SAMPLES,
  THEME_KEY,
} from "@/lib/emulator";
import { Machine } from "@/lib/emulator/machine";

export type Theme = "dark" | "light";

/** Cap step-back history (each entry holds a 64 KiB memory copy). */
export const MAX_STEP_HISTORY = 512;

export function useEmulator(initialSource?: string) {
  const [source, setSource] = useState(initialSource ?? DEFAULT_SOURCE);
  const [assembled, setAssembled] = useState<AssembledProgram | null>(null);
  const [machine, setMachine] = useState<Machine | null>(null);
  const [runState, setRunState] = useState<RunState>("idle");
  const [assemblyError, setAssemblyError] = useState<string | null>(null);
  const [assemblyErrorLine, setAssemblyErrorLine] = useState<number | null>(
    null,
  );
  const [breakpoints, setBreakpoints] = useState<Set<number>>(new Set());
  const [runSpeed, setRunSpeed] = useState(16);
  const [theme, setTheme] = useState<Theme>("dark");
  const [hexBase, setHexBase] = useState(0);
  const [tick, setTick] = useState(0);
  const [canStepBack, setCanStepBack] = useState(false);

  const runTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const guardRef = useRef(0);
  const machineRef = useRef<Machine | null>(null);
  const breakpointsRef = useRef(breakpoints);
  /** Reversible history for Step Back (oldest → newest). */
  const historyRef = useRef<FullMachineState[]>([]);
  /** True after Run until Pause / halt / reset — survives INT 21h input waits. */
  const keepRunningRef = useRef(false);

  useEffect(() => {
    machineRef.current = machine;
  }, [machine]);

  useEffect(() => {
    breakpointsRef.current = breakpoints;
  }, [breakpoints]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const applyTheme = useCallback((next: Theme) => {
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(THEME_KEY, next);
  }, []);

  useEffect(() => {
    const savedTheme = localStorage.getItem(THEME_KEY) as Theme | null;
    if (savedTheme === "light" || savedTheme === "dark") {
      document.documentElement.setAttribute("data-theme", savedTheme);
      queueMicrotask(() => setTheme(savedTheme));
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem(AUTOSAVE_KEY, source);
    }, 500);
    return () => clearTimeout(timer);
  }, [source]);

  const stopTimer = useCallback(() => {
    if (runTimerRef.current) {
      clearInterval(runTimerRef.current);
      runTimerRef.current = null;
    }
    guardRef.current = 0;
  }, []);

  const stopRun = useCallback(() => {
    keepRunningRef.current = false;
    stopTimer();
  }, [stopTimer]);

  const clearHistory = useCallback(() => {
    historyRef.current = [];
    setCanStepBack(false);
  }, []);

  const pushHistory = useCallback((m: Machine) => {
    historyRef.current.push(m.capture());
    if (historyRef.current.length > MAX_STEP_HISTORY) {
      historyRef.current.shift();
    }
    setCanStepBack(true);
  }, []);

  const doAssemble = useCallback(() => {
    stopRun();
    clearHistory();
    setAssemblyError(null);
    setAssemblyErrorLine(null);
    try {
      const program = assemble(source);
      const m = createMachine(program);
      setAssembled(program);
      setMachine(m);
      machineRef.current = m;
      setRunState("ready");
      refresh();
      return true;
    } catch (e) {
      const err = e as Error & { line?: number };
      const line =
        typeof err.line === "number"
          ? err.line
          : (() => {
              const m = (err.message ?? "").match(/\bline\s+(\d+)\b/i);
              return m ? parseInt(m[1], 10) : null;
            })();
      const msg = err.message ?? "Assembly failed";
      setAssembled(null);
      setMachine(null);
      machineRef.current = null;
      setAssemblyError(line != null ? `Line ${line}: ${msg}` : msg);
      setAssemblyErrorLine(line);
      setRunState("error");
      refresh();
      return false;
    }
  }, [source, stopRun, refresh, clearHistory]);

  const doReset = useCallback(() => {
    stopRun();
    clearHistory();
    if (assembled) {
      const m = createMachine(assembled);
      setMachine(m);
      machineRef.current = m;
      setRunState("ready");
      refresh();
    } else {
      setMachine(null);
      machineRef.current = null;
      setRunState("idle");
      setAssemblyError(null);
      setAssemblyErrorLine(null);
      refresh();
    }
  }, [assembled, stopRun, refresh, clearHistory]);

  const updateRunStateFromMachine = useCallback(
    (m: Machine) => {
      if (m.err) setRunState("error");
      else if (m.halted) setRunState("halted");
      else if (m.waitingForInput && keepRunningRef.current) setRunState("running");
      else setRunState("ready");
      refresh();
    },
    [refresh],
  );

  const doStep = useCallback(() => {
    const m = machineRef.current;
    if (!m || m.halted || m.waitingForInput) return;
    pushHistory(m);
    m.step();
    updateRunStateFromMachine(m);
  }, [updateRunStateFromMachine, pushHistory]);

  const doStepBack = useCallback(() => {
    const m = machineRef.current;
    if (!m) return;
    const prev = historyRef.current.pop();
    if (!prev) return;
    stopRun();
    m.restore(prev);
    setCanStepBack(historyRef.current.length > 0);
    updateRunStateFromMachine(m);
  }, [stopRun, updateRunStateFromMachine]);

  const runBatch = useCallback(() => {
    const m = machineRef.current;
    if (!m || m.halted || m.err) {
      stopRun();
      if (m) updateRunStateFromMachine(m);
      return;
    }
    if (m.waitingForInput) {
      stopTimer();
      updateRunStateFromMachine(m);
      return;
    }

    // One reversible checkpoint per batch so Step Back can undo a Run burst.
    pushHistory(m);
    let ok = true;
    for (let i = 0; i < 200 && ok; i++) {
      if (m.waitingForInput) break;
      const line = m.getCurrentLine();
      if (line !== null && breakpointsRef.current.has(line)) {
        stopRun();
        updateRunStateFromMachine(m);
        return;
      }
      ok = m.step();
      guardRef.current++;
      if (m.waitingForInput) break;
      if (guardRef.current > INSTRUCTION_LIMIT) {
        m.err = "Instruction limit exceeded (possible infinite loop).";
        m.halted = true;
        ok = false;
      }
    }
    updateRunStateFromMachine(m);
    if (m.waitingForInput) {
      stopTimer();
      return;
    }
    if (!ok || m.halted || m.err) stopRun();
  }, [stopRun, stopTimer, updateRunStateFromMachine, pushHistory]);

  const doRun = useCallback(() => {
    const m = machineRef.current;
    if (!m || m.halted) return;
    stopTimer();
    keepRunningRef.current = true;
    setRunState("running");
    guardRef.current = 0;
    runTimerRef.current = setInterval(runBatch, runSpeed);
    runBatch();
  }, [runBatch, runSpeed, stopTimer]);

  const doPause = useCallback(() => {
    stopRun();
    if (machineRef.current && !machineRef.current.halted) {
      setRunState("ready");
      refresh();
    }
  }, [stopRun, refresh]);

  const toggleBreakpoint = useCallback((line: number) => {
    setBreakpoints((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
  }, []);

  const loadSample = useCallback(
    (key: SampleKey) => {
      stopRun();
      clearHistory();
      setSource(SAMPLES[key]);
      setAssembled(null);
      setMachine(null);
      machineRef.current = null;
      setRunState("idle");
      setAssemblyError(null);
      setAssemblyErrorLine(null);
      refresh();
    },
    [stopRun, refresh, clearHistory],
  );

  const shareLink = useCallback(() => {
    const encoded = encodeProgramToShare(source);
    return `${window.location.origin}/?p=${encodeURIComponent(encoded)}`;
  }, [source]);

  const provideInput = useCallback(
    (chars: string) => {
      const m = machineRef.current;
      if (!m || !chars) return;
      // Input unblocks execution — keep it reversible where we single-step.
      const wasRunning = keepRunningRef.current;
      if (!wasRunning) pushHistory(m);
      m.enqueueInput(chars);
      if (keepRunningRef.current) {
        if (!runTimerRef.current) {
          setRunState("running");
          runTimerRef.current = setInterval(runBatch, runSpeed);
        }
        runBatch();
        return;
      }
      m.step();
      updateRunStateFromMachine(m);
    },
    [runBatch, runSpeed, updateRunStateFromMachine, pushHistory],
  );

  useEffect(() => () => stopRun(), [stopRun]);

  return {
    source,
    setSource,
    assembled,
    machine,
    runState,
    assemblyError,
    assemblyErrorLine,
    breakpoints,
    toggleBreakpoint,
    runSpeed,
    setRunSpeed,
    theme,
    applyTheme,
    hexBase,
    setHexBase,
    tick,
    doAssemble,
    doReset,
    doStep,
    doStepBack,
    canStepBack,
    doRun,
    doPause,
    loadSample,
    shareLink,
    provideInput,
    isRunning: runState === "running",
  };
}
