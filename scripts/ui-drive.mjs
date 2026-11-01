// Drive the real app in headless Chrome (DevTools protocol, no extra packages) and take screenshots at an
// exact size. Used for docs/screens and end-to-end runs; it clicks the UI like a person, it never sets data.
//
//   const ui = await openApp("http://localhost:8830/", { width: 375, height: 812, mobile: true });
//   await ui.click("#btn-check"); await ui.waitFor("() => !document.querySelector('#findings-busy').hidden === false");
//   await ui.shot("docs/screens/x.jpg"); await ui.close();
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export async function openApp(url, { width = 1440, height = 900, mobile = false, port = 9300 + Math.floor(Math.random() * 500) } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pr-chrome-"));
  const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "--no-first-run",
    "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars", `--window-size=${width},${height}`, "about:blank"], { stdio: "ignore" });
  let info;
  for (let i = 0; i < 50 && !info; i++) {
    await sleep(200);
    info = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).then((l) => l.find((t) => t.type === "page")).catch(() => null);
  }
  if (!info) { proc.kill(); throw new Error("Chrome didn't start"); }
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  let id = 0;
  const waiting = new Map(), logs = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) { const { ok, no } = waiting.get(msg.id); waiting.delete(msg.id); msg.error ? no(new Error(msg.error.message)) : ok(msg.result); }
    if (msg.method === "Runtime.consoleAPICalled") logs.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`);
    if (msg.method === "Runtime.exceptionThrown") logs.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  };
  const send = (method, params = {}) => new Promise((ok, no) => { const i = ++id; waiting.set(i, { ok, no }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  if (mobile) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Page.navigate", { url });

  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const ui = {
    logs, evaluate,
    // wait until a JS expression (a function body returning truthy) holds
    async waitFor(fn, { timeout = 60000, every = 250 } = {}) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        if (await evaluate(`(${fn})()`).catch(() => false)) return Date.now() - t0;
        await sleep(every);
      }
      throw new Error(`timed out waiting for ${fn}`);
    },
    // a real click at the element's centre (mouse events, like a person). A CSS selector, or { js: "expression" }.
    async click(selector) {
      const pick = typeof selector === "string" ? `document.querySelector(${JSON.stringify(selector)})` : selector.js;
      const box = await evaluate(`(() => { const e = ${pick}; if (!e) return null; e.scrollIntoView({ block: "nearest" }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      if (!box) throw new Error(`nothing to click: ${selector}`);
      for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
    },
    async type(text) { await send("Input.insertText", { text }); },
    async upload(selector, files) {
      const { root } = await send("DOM.getDocument");
      const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector });
      await send("DOM.setFileInputFiles", { nodeId, files });
    },
    async shot(path, { quality = 72 } = {}) {
      const r = await send("Page.captureScreenshot", { format: "jpeg", quality });
      writeFileSync(path, Buffer.from(r.data, "base64"));
      return path;
    },
    async close() { try { ws.close(); } catch {} proc.kill(); },
  };
  return ui;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
