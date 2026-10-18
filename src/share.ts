// Crash-clip recording and export (SPEC §8): the whole run is recorded from the WebGL canvas; at the result card the
// funniest moment (the biggest crash, else the finish) is re-encoded into a short MP4/WebM with the game name and
// THIS SIDE UP burned in, and downloaded. No server involved.

const PRE = 4.5; // seconds before the moment
const POST = 4.0; // seconds after

function pickMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const m of [
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4;codecs=avc1",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ])
    if (MediaRecorder.isTypeSupported(m)) return m;
  return null;
}

export class ClipRecorder {
  readonly supported: boolean;
  private mime: string | null;
  private rec: MediaRecorder | null = null;
  available = false;
  private startedAt = 0;
  private stoppedElapsed: number | null = 0;
  private finishRun: ((ok: boolean) => void) | null = null;
  private blob: Blob | null = null;
  private stopping: Promise<void> | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | undefined;

  /** Downscaled copy of the WebGL canvas that is actually recorded: a full-res WebGL readback every frame stalls the GPU. */
  private mirror: HTMLCanvasElement;
  private mirrorCtx: CanvasRenderingContext2D | null;
  private frameParity = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.mime = pickMime();
    this.mirror = document.createElement("canvas");
    this.mirrorCtx = this.mirror.getContext("2d", { alpha: false });
    this.supported =
      !!this.mime &&
      !!this.mirrorCtx &&
      typeof (this.mirror as HTMLCanvasElement & { captureStream?: unknown })
        .captureStream === "function";
  }

  /** Call once per rendered frame (after the WebGL render): copies every other frame into the recorded mirror canvas. */
  capture(): void {
    if (!this.rec || this.rec.state !== "recording" || !this.mirrorCtx) return;
    if ((this.frameParity ^= 1) === 0) return;
    const W = 960,
      H = Math.max(
        2,
        Math.round((960 * this.canvas.height) / this.canvas.width),
      );
    if (this.mirror.width !== W || this.mirror.height !== H) {
      this.mirror.width = W;
      this.mirror.height = H;
    }
    try {
      this.mirrorCtx.drawImage(this.canvas, 0, 0, W, H);
    } catch {
      this.finishRun?.(false);
    }
  }

  /** Begin recording a run (call when the session starts). */
  start(): void {
    this.discard();
    if (!this.supported || !this.mime) return;
    let stream: MediaStream | null = null;
    let ready = false;
    try {
      const W = 960,
        H = Math.max(
          2,
          Math.round((960 * this.canvas.height) / this.canvas.width),
        );
      this.mirror.width = W;
      this.mirror.height = H;
      stream = this.mirror.captureStream(30);
      const rec = new MediaRecorder(stream, {
        mimeType: this.mime,
        videoBitsPerSecond: 4_000_000,
      });
      this.rec = rec;
      const chunks: Blob[] = [];
      let finished = false;
      this.stopping = new Promise<void>((resolve) => {
        this.finishRun = (ok) => {
          if (finished) return;
          finished = true;
          clearTimeout(this.stopTimer);
          this.stoppedElapsed ??= (performance.now() - this.startedAt) / 1000;
          try {
            this.blob = ok
              ? new Blob(chunks, { type: rec.mimeType || this.mime! })
              : null;
            this.available = !!this.blob?.size;
          } finally {
            rec.ondataavailable = rec.onstop = rec.onerror = null;
            stopMedia(rec, stream);
            this.rec = null;
            this.finishRun = null;
            resolve();
          }
        };
      });
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      rec.onstop = () => this.finishRun?.(true);
      rec.onerror = () => this.finishRun?.(false);
      this.startedAt = performance.now();
      this.stoppedElapsed = null;
      rec.start(1000);
      this.available = ready = true;
    } catch (e) {
      console.warn("clip recording unavailable", e);
      this.finishRun?.(false);
      this.available = false;
    } finally {
      if (!ready) {
        stopMedia(this.rec, stream);
        this.rec = null;
      }
    }
  }

  /** Stop recording (call at the result). Resolves when the full blob is ready. */
  stop(): Promise<void> {
    this.stoppedElapsed ??= (performance.now() - this.startedAt) / 1000;
    if (this.rec && this.rec.state !== "inactive") {
      try {
        this.stopTimer = setTimeout(() => this.finishRun?.(false), 5000);
        this.rec.stop();
      } catch {
        this.finishRun?.(false);
      }
    }
    return this.stopping ?? Promise.resolve();
  }

  discard(): void {
    this.finishRun?.(false);
    this.rec = null;
    this.stopping = null;
    this.blob = null;
    this.available = false;
    this.stoppedElapsed = 0;
  }

  /** Wall-clock media time, frozen at stop; simulation can deliberately drop debt. */
  get elapsed(): number {
    return this.stoppedElapsed ?? (performance.now() - this.startedAt) / 1000;
  }

  /**
   * Export a short clip around `moment` (seconds since start) and trigger a download.
   * Re-encodes through a <video> + 2D canvas so the watermark can be burned in; falls back to the full run.
   */
  async exportClip(
    moment: number,
    total: number,
    label: string,
    onProgress?: (s: string) => void,
  ): Promise<boolean> {
    const pending = this.stopping;
    if (pending) await pending;
    if (
      pending !== this.stopping ||
      !this.available ||
      !this.blob ||
      !this.mime
    )
      return false;
    const src = this.blob;
    const mime = this.mime;
    total = Math.min(total, this.elapsed);
    const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
    onProgress?.("SAVING…");
    try {
      let out: Blob;
      try {
        out = await this.reencode(src, moment, total, label, mime);
      } catch (e) {
        console.warn("clip re-encode failed, saving the whole run", e);
        out = src;
      }
      download(
        out,
        `late-roadster-${label.toLowerCase().replace(/\s+/g, "-")}.${ext}`,
      );
      onProgress?.("SAVED");
      return true;
    } catch {
      onProgress?.("CLIP UNAVAILABLE");
      return false;
    }
  }

  private async reencode(
    src: Blob,
    moment: number,
    total: number,
    label: string,
    mime: string,
  ): Promise<Blob> {
    const url = URL.createObjectURL(src);
    const video = document.createElement("video");
    let stream: MediaStream | null = null;
    let rec: MediaRecorder | null = null;
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      video.muted = true;
      video.playsInline = true;
      await mediaEvent(video, "loadedmetadata", () => {
        video.src = url;
      });
      // Fragmented recordings may need an end probe before their duration is finite.
      if (!Number.isFinite(video.duration))
        await mediaEvent(video, "timeupdate", () => {
          video.currentTime = 1e9;
        });
      const duration = Math.min(total, video.duration);
      if (!Number.isFinite(duration) || duration < 1)
        throw new Error("no duration");
      const t0 = Math.max(0, Math.min(moment - PRE, duration - PRE - POST));
      const t1 = Math.min(duration, t0 + PRE + POST);
      if (video.currentTime !== t0)
        await mediaEvent(video, "seeked", () => {
          video.currentTime = t0;
        });
      const W = 1280,
        H = Math.round((W * video.videoHeight) / video.videoWidth);
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const ctx = c.getContext("2d");
      if (!ctx) throw new Error("no export canvas");
      stream = c.captureStream(30);
      const recorder = (rec = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: 5_000_000,
      }));
      const parts: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) parts.push(e.data);
      };
      let failRecording: (error: Error) => void = () => {};
      const done = new Promise<Blob>((resolve, reject) => {
        failRecording = reject;
        recorder.onstop = () => resolve(new Blob(parts, { type: mime }));
        recorder.onerror = () => reject(new Error("export recording failed"));
      });
      // The recorder may fail before drawing finishes; observe that rejection immediately.
      void done.catch(() => {});
      recorder.start(250);
      await mediaEvent(video, "playing", () => {
        void video.play().catch(failRecording);
      });
      await Promise.race([
        done.then(() => {
          throw new Error("export stopped early");
        }),
        new Promise<void>((resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error("export timed out")),
            (t1 - t0 + 10) * 1000,
          );
          const draw = () => {
            try {
              ctx.drawImage(video, 0, 0, W, H);
              watermark(ctx, W, H, label);
              if (video.currentTime >= t1 || video.ended) resolve();
              else raf = requestAnimationFrame(draw);
            } catch (error) {
              reject(error);
            }
          };
          draw();
        }),
      ]);
      video.pause();
      recorder.stop();
      stopTimer = setTimeout(
        () => failRecording(new Error("export stop timed out")),
        5000,
      );
      const out = await done;
      if (!out.size) throw new Error("empty export");
      return out;
    } finally {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      clearTimeout(stopTimer);
      if (rec) rec.ondataavailable = rec.onstop = rec.onerror = null;
      stopMedia(rec, stream);
      video.pause();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    }
  }
}

function stopMedia(
  rec: MediaRecorder | null,
  stream: MediaStream | null,
): void {
  try {
    if (rec && rec.state !== "inactive") rec.stop();
  } catch {
    // A failed encoder may already be stopped.
  } finally {
    for (const track of stream?.getTracks() ?? []) track.stop();
  }
}

async function mediaEvent(
  video: HTMLVideoElement,
  event: string,
  action: () => void,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let success = () => {};
  let failure = () => {};
  try {
    await new Promise<void>((resolve, reject) => {
      success = resolve;
      failure = () => reject(new Error("video " + event));
      video.addEventListener(event, success, { once: true });
      video.addEventListener("error", failure, { once: true });
      timer = setTimeout(failure, 10000);
      action();
    });
  } finally {
    clearTimeout(timer);
    video.removeEventListener(event, success);
    video.removeEventListener("error", failure);
  }
}

function watermark(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  label: string,
): void {
  ctx.save();
  ctx.font = `800 ${Math.round(H * 0.045)}px system-ui, sans-serif`;
  ctx.textBaseline = "bottom";
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.fillStyle = "#ffd23f";
  ctx.textAlign = "left";
  ctx.strokeText("LATE ROADSTER", 24, H - 22);
  ctx.fillText("LATE ROADSTER", 24, H - 22);
  ctx.textAlign = "right";
  ctx.fillStyle = "#fff";
  ctx.strokeText("THIS SIDE UP ↑", W - 24, H - 22);
  ctx.fillText("THIS SIDE UP ↑", W - 24, H - 22);
  ctx.font = `700 ${Math.round(H * 0.03)}px system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText(label, 24, H - 22 - Math.round(H * 0.05));
  ctx.restore();
}

function download(blob: Blob, name: string): void {
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  try {
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
  } finally {
    a.remove();
    // Allow the browser to begin consuming the download before releasing its URL.
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}
