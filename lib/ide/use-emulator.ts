"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  assemble,
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

/**
 * Cap step-back history (each entry holds a 64 KiB memory copy, so 256 entries
 * is ~16 MiB of retained snapshots).
 */
export const MAX_STEP_HISTORY = 256;

/**
 * Minimum wall-clock gap between step-back checkpoints taken during a
 * continuous Run.
 *
 * Step Back's contract is "undo a Run burst", not "undo every 16 ms slice".
 * Capturing on every loop tick burned 512 snapshots in ~8 seconds of running;
 * at this cadence a long run records a few dozen, which is the same
 * user-visible undo depth for a fraction of the memory.
 */
const RUN_CHECKPOINT_MS = 250;

/** Instructions retired per animation frame before yielding to the browser. */
const MAX_STEPS_PER_FRAME = 2000;

/**
 * Cap on how much wall-clock time a single frame may retire. A backgrounded
 * tab delivers one huge `now - last` gap on return; without this the loop
 * would try to catch up in a single task and lock the UI.
 */
const MAX_FRAME_MS = 250;

/** Tick interval used while the document is hidden and rAF is suspended. */
const HIDDEN_TICK_MS = 16;

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

  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const guardRef = useRef(0);
  const machineRef = useRef<Machine | null>(null);
  const breakpointsRef = useRef(breakpoints);
  /** Reversible history for Step Back (oldest → newest). */
  const historyRef = useRef<FullMachineState[]>([]);
  /** True after Run until Pause / halt / reset — survives INT 21h input waits. */
  const keepRunningRef = useRef(false);
  /** Read by the run loop so the Speed slider applies without restarting. */
  const speedRef = useRef(runSpeed);
  /** Instruction debt carried between frames, in milliseconds. */
  const accRef = useRef(0);
  /** `performance.now()` of the previous run frame. */
  const lastFrameRef = useRef(0);
  /** Timestamp of the last step-back checkpoint taken during a run. */
  const lastCheckpointRef = useRef(0);
  /** Latest run-loop body, so a queued frame always calls the current one. */
  const loopRef = useRef<(now: number) => void>(() => {});

  useEffect(() => {
    machineRef.current = machine;
  }, [machine]);

  useEffect(() => {
    breakpointsRef.current = breakpoints;
  }, [breakpoints]);

  useEffect(() => {
    speedRef.current = runSpeed;
  }, [runSpeed]);

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

  /** Cancel whichever kind of tick is pending. */
  const cancelTick = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopTimer = useCallback(() => {
    cancelTick();
    guardRef.current = 0;
    accRef.current = 0;
  }, [cancelTick]);

  const stopRun = useCallback(() => {
    keepRunningRef.current = false;
    stopTimer();
  }, [stopTimer]);

  const clearHistory = useCallback(() => {
    historyRef.current = [];
    lastCheckpointRef.current = 0;
    setCanStepBack(false);
  }, []);

  const pushHistory = useCallback((m: Machine) => {
    historyRef.current.push(m.capture());
    if (historyRef.current.length > MAX_STEP_HISTORY) {
      historyRef.current.shift();
    }
    setCanStepBack(true);
  }, []);

  /**
   * Record a step-back checkpoint during a run, rate-limited so a long
   * execution retains a handful of snapshots rather than one per frame.
   */
  const checkpoint = useCallback(
    (m: Machine) => {
      const now = performance.now();
      if (now - lastCheckpointRef.current < RUN_CHECKPOINT_MS) return;
      lastCheckpointRef.current = now;
      pushHistory(m);
    },
    [pushHistory],
  );

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

  /**
   * Queue the next run tick. Reads the loop body through a ref so the loop can
   * reschedule itself without a self-referential closure.
   *
   * Uses rAF while the document is visible so stepping is aligned to the
   * display and costs at most one render per frame. A hidden tab never gets
   * rAF callbacks at all, which would leave the IDE showing "running" while
   * frozen, so fall back to a timer there and resync on return.
   */
  const scheduleFrame = useCallback(() => {
    if (typeof document !== "undefined" && document.hidden) {
      timerRef.current = setTimeout(
        () => loopRef.current(performance.now()),
        HIDDEN_TICK_MS,
      );
      return;
    }
    rafRef.current = requestAnimationFrame((now) => loopRef.current(now));
  }, []);

  /**
   * One animation frame of execution: retire however many instructions the
   * elapsed time owes, then render at most once.
   *
   * This replaced a `setInterval`. The interval captured `runSpeed` when it was
   * created, so the Speed slider did nothing until Run was pressed again, and
   * each callback both retired instructions and forced a full-IDE React render
   * in the same task. Driving from rAF makes the slider live, bounds the render
   * rate to the display, and lets a fast program catch up inside one frame
   * instead of queueing more timers than the browser will honour.
   */
  const runFrame = useCallback(
    (now: number) => {
      rafRef.current = null;
      timerRef.current = null;
      const m = machineRef.current;
      if (!m) {
        stopRun();
        return;
      }

      if (m.halted || m.err) {
        updateRunStateFromMachine(m);
        stopRun();
        return;
      }
      if (m.waitingForInput) {
        // Park on the prompt but stay "running" so provideInput can resume.
        updateRunStateFromMachine(m);
        stopTimer();
        return;
      }

      const elapsed = Math.min(Math.max(now - lastFrameRef.current, 0), MAX_FRAME_MS);
      lastFrameRef.current = now;
      accRef.current += elapsed;

      const perStep = Math.max(1, speedRef.current);
      let executed = 0;
      let paused = false;
      let exhausted = false;

      while (accRef.current >= perStep && executed < MAX_STEPS_PER_FRAME) {
        if (m.waitingForInput) {
          paused = true;
          break;
        }
        const line = m.getCurrentLine();
        if (line !== null && breakpointsRef.current.has(line)) {
          paused = true;
          break;
        }
        accRef.current -= perStep;
        executed += 1;
        guardRef.current += 1;
        if (!m.step()) {
          // step() also reports false when it parks for console input, which
          // must keep the run intent alive so provideInput can resume.
          if (m.waitingForInput) paused = true;
          else exhausted = true;
          break;
        }
        if (m.waitingForInput) {
          paused = true;
          break;
        }
        if (guardRef.current > INSTRUCTION_LIMIT) {
          m.err = "Instruction limit exceeded (possible infinite loop).";
          m.halted = true;
          exhausted = true;
          break;
        }
      }

      // Dropped frames: keep the debt bounded so a slow program does not
      // spiral into an ever-growing backlog.
      if (accRef.current > MAX_FRAME_MS) accRef.current = MAX_FRAME_MS;

      if (executed > 0) checkpoint(m);
      if (executed > 0 || paused || exhausted) {
        updateRunStateFromMachine(m);
      }

      if (exhausted) {
        stopRun();
        return;
      }
      if (paused) {
        // A breakpoint or an input wait: park the loop but keep the run
        // intent so typing into the console resumes execution.
        if (m.waitingForInput) stopTimer();
        else stopRun();
        return;
      }

      scheduleFrame();
    },
    [checkpoint, scheduleFrame, stopRun, stopTimer, updateRunStateFromMachine],
  );

  // Keep the queued frame pointing at the current loop body.
  useEffect(() => {
    loopRef.current = runFrame;
  }, [runFrame]);

  // Coming back from a hidden tab: drop the accumulated debt so the first
  // visible frame does not try to catch up on all the hidden time at once.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) return;
      accRef.current = 0;
      lastFrameRef.current = performance.now();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () =>
      document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const doRun = useCallback(() => {
    const m = machineRef.current;
    if (!m || m.halted) return;
    stopTimer();
    keepRunningRef.current = true;
    setRunState("running");
    guardRef.current = 0;
    accRef.current = 0;
    lastFrameRef.current = performance.now();
    lastCheckpointRef.current = 0;
    scheduleFrame();
  }, [scheduleFrame, stopTimer]);

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
        if (rafRef.current === null) {
          setRunState("running");
          accRef.current = 0;
          lastFrameRef.current = performance.now();
          scheduleFrame();
        }
        return;
      }
      m.step();
      updateRunStateFromMachine(m);
    },
    [scheduleFrame, updateRunStateFromMachine, pushHistory],
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
