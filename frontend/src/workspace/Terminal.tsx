import { ClipboardAddon, IClipboardProvider } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";

/** OSC 52 clipboard writes go to the browser clipboard whatever selection they name: tmux sends an empty one, which
 * the addon's default provider ignores (it only takes "c"). Reads are refused so programs can't query the clipboard. */
const clipboard: IClipboardProvider = {
  readText: () => "",
  writeText: (_selection, text) => navigator.clipboard.writeText(text).catch(() => {}),
};

const MIN_HEIGHT = 80; // don't resize the pty while the region is collapsed to its tab bar

export default function Terminal({ sessionId }: { sessionId: number }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = container.current!;
    const term = new XTerm({
      fontFamily: '"IBM Plex Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true, // needed to select the unicode version below
      theme: { background: "#0B0C0E", foreground: "#D6D3CC" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    // tmux and the agent's UI lay out text with modern Unicode widths (symbols, emoji, box drawing); xterm's older
    // default disagrees about some characters, so the cursor drifts and lines overwrite each other.
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    // Dragging selects in tmux (its mouse mode is on); on release tmux copies and sends the text as an OSC 52
    // escape, which this addon writes to the browser clipboard. Apps like Claude Code copy the same way.
    term.loadAddon(new ClipboardAddon(undefined, clipboard));
    term.open(el);
    // The web font loads late; xterm measures cell width at open, so re-measure once it's in or columns drift.
    let disposed = false;
    document.fonts.load('13px "IBM Plex Mono"').then(() => {
      if (disposed) return;
      term.options.fontFamily = '"IBM Plex Mono", monospace';
      term.clearTextureAtlas();
      sent = "";
      sendSize();
    });
    // Ctrl+Up/Down belong to the app's layout shortcuts, not the pty.
    term.attachCustomKeyEventHandler((e) => !(e.ctrlKey && (e.key === "ArrowUp" || e.key === "ArrowDown")));

    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/sessions/${sessionId}/ws`);
    ws.binaryType = "arraybuffer";
    // Resize only once the size settles and actually changed: resizing on every frame of a drag, mid-stream,
    // leaves tmux redrawing for sizes the terminal has already left, which garbles the screen.
    let sent = "";
    const sendSize = () => {
      if (el.clientHeight < MIN_HEIGHT || ws.readyState !== WebSocket.OPEN) return;
      const size = fit.proposeDimensions();
      if (!size || `${size.cols}x${size.rows}` === sent) return;
      sent = `${size.cols}x${size.rows}`;
      fit.fit();
      term.refresh(0, term.rows - 1);
      ws.send(JSON.stringify({ resize: [term.cols, term.rows] }));
    };
    let timer: number | undefined;
    const sendSizeSoon = () => (window.clearTimeout(timer), (timer = window.setTimeout(sendSize, 120)));
    ws.onopen = () => (sendSize(), term.focus());
    ws.onmessage = (e) => term.write(new Uint8Array(e.data));
    ws.onclose = () => term.write("\r\n\x1b[90m[disconnected]\x1b[0m\r\n");
    term.onData((data) => ws.readyState === WebSocket.OPEN && ws.send(new TextEncoder().encode(data)));

    const observer = new ResizeObserver(sendSizeSoon);
    observer.observe(el);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      observer.disconnect();
      ws.close();
      term.dispose();
    };
  }, [sessionId]);

  // FitAddon sizes to the host's content box but ignores the host's own padding, so pad an outer wrapper.
  return (
    <div className="xterm-host">
      <div ref={container} style={{ height: "100%" }} />
    </div>
  );
}
