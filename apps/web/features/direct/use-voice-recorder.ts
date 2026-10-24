"use client";

import { useEffect, useRef, useState } from "react";
import { voiceMessageRules } from "@instagram/contracts";

// Capture never starts automatically. Tracks and timers are stopped on cancel,
// navigation, logout and every error, including a late microphone permission.
export function useVoiceRecorder(onRecorded: (file: File) => void) {
  const [state, setState] = useState<
    "idle" | "starting" | "recording" | "stopping"
  >("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string>();
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const cancelled = useRef(false);
  const mounted = useRef(true);
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const callback = useRef(onRecorded);
  useEffect(() => {
    callback.current = onRecorded;
  });
  function release() {
    if (timer.current) clearInterval(timer.current);
    timer.current = undefined;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelled.current = true;
      if (timer.current) clearInterval(timer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function start() {
    if (pending.current) return;
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError(
        "Запись недоступна. Откройте сайт по HTTPS в браузере с поддержкой записи звука.",
      );
      return;
    }
    pending.current = true;
    cancelled.current = false;
    setError(undefined);
    setSeconds(0);
    setState("starting");
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      if (!mounted.current || cancelled.current) {
        acquired.getTracks().forEach((track) => track.stop());
        pending.current = false;
        return;
      }
      stream.current = acquired;
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("unsupported");
      const current = new MediaRecorder(acquired, {
        mimeType,
        audioBitsPerSecond: 64000,
      });
      recorder.current = current;
      const chunks: Blob[] = [];
      let size = 0;
      current.ondataavailable = (event) => {
        if (recorder.current !== current) return;
        size += event.data.size;
        if (size <= voiceMessageRules.maxBytes) chunks.push(event.data);
        else {
          cancelled.current = true;
          if (mounted.current)
            setError("Запись больше 10 МБ. Запишите сообщение короче.");
          if (current.state === "recording") current.stop();
        }
      };
      current.onerror = () => {
        if (recorder.current !== current) return;
        cancelled.current = true;
        release();
        if (mounted.current) {
          setState("stopping");
          setError("Запись прервана. Попробуйте ещё раз.");
        }
        if (current.state === "recording") current.stop();
      };
      current.onstop = () => {
        if (recorder.current !== current) return;
        release();
        recorder.current = null;
        pending.current = false;
        if (!mounted.current) return;
        setState("idle");
        if (cancelled.current) return;
        const blob = new Blob(chunks, { type: current.mimeType });
        if (!blob.size) {
          setError("Запись пуста. Попробуйте ещё раз.");
          return;
        }
        callback.current(
          new File(
            [blob],
            mimeType.startsWith("audio/mp4")
              ? "voice.m4a"
              : mimeType.startsWith("audio/ogg")
                ? "voice.ogg"
                : "voice.webm",
            { type: current.mimeType },
          ),
        );
      };
      current.start(250);
      setState("recording");
      const started = Date.now();
      timer.current = setInterval(() => {
        const elapsed = Date.now() - started;
        if (mounted.current) setSeconds(Math.floor(elapsed / 1000));
        if (
          elapsed >= voiceMessageRules.maxDurationMs - 1000 &&
          current.state === "recording"
        ) {
          if (mounted.current) setState("stopping");
          current.stop();
          release();
        }
      }, 250);
    } catch {
      recorder.current = null;
      release();
      pending.current = false;
      if (mounted.current) {
        setState("idle");
        setError(
          "Не удалось включить микрофон. Проверьте разрешение браузера и попробуйте снова.",
        );
      }
    }
  }
  function stop(cancel = false) {
    cancelled.current = cancel;
    if (recorder.current?.state === "recording") {
      setState("stopping");
      recorder.current.stop();
      release();
    } else if (cancel) {
      release();
      setState("idle");
    }
  }
  return {
    state,
    seconds,
    error,
    start,
    stop: () => stop(),
    cancel: () => stop(true),
  };
}
