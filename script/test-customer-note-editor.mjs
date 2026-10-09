// Synthetic component smoke test. See docs/customer-note-editing.md for setup.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { chromium } from "playwright";

const result = await build({
  stdin: { contents: `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { CustomerNoteEditor } from './client/src/components/customer-note-editor';
    const initial = { id: 'synthetic-note', customerId: 'synthetic-customer', text: 'Original synthetic note', author: 'Synthetic Staff', date: '2026-10-09' };
    window.calls = 0; window.mode = 'ok';
    function Harness() {
      const [note, setNote] = useState(JSON.parse(localStorage.getItem('synthetic-note') || 'null') || initial);
      const [scope, setScope] = useState('synthetic-user-a');
      window.switchScope = () => setScope('synthetic-user-b');
      window.concurrentEdit = () => {
        const next = { ...note, text: 'Concurrent edit' };
        localStorage.setItem('synthetic-note', JSON.stringify(next)); setNote(next);
      };
      const save = async (original, text) => {
        window.calls++;
        await new Promise(resolve => setTimeout(resolve, 150));
        if (window.mode === 'error') throw new Error('Synthetic write unavailable');
        const stored = JSON.parse(localStorage.getItem('synthetic-note') || 'null') || initial;
        if (stored.text !== original.text && stored.text !== text) throw new Error('This note changed. Your draft is retained.');
        const next = { ...stored, text }; localStorage.setItem('synthetic-note', JSON.stringify(next)); setNote(next);
      };
      return <main>{['Overview', 'Timeline'].map(view => <section key={view} aria-label={view}>
        <h1>{view}</h1><CustomerNoteEditor key={scope} note={note} onSave={save}/>
      </section>)}</main>;
    }
    createRoot(document.getElementById('root')).render(<Harness/>);
  `, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
});
const server = createServer((request, response) => {
  response.setHeader("content-type", request.url === "/app.js" ? "application/javascript" : "text/html");
  response.end(request.url === "/app.js" ? result.outputFiles[0].text : '<!doctype html><html><body><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.request().url().startsWith("http://127.0.0.1:") ? route.continue() : route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const trigger = page.getByRole("region", { name: "Overview" }).getByRole("button", { name: "Edit note by Synthetic Staff from 2026-10-09" });
  const editor = page.getByRole("textbox", { name: "Note", exact: true });
  const dialog = page.getByRole("dialog", { name: "Edit customer note" });
  const waitClosed = () => dialog.waitFor({ state: "hidden" });

  await trigger.focus(); await page.keyboard.press("Enter");
  await editor.waitFor(); assert.equal(await editor.inputValue(), "Original synthetic note");
  assert.equal(await editor.evaluate(el => el === document.activeElement), true);
  await editor.fill("Discard this draft"); await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await waitClosed(); assert.equal(await page.evaluate(() => window.calls), 0);
  assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
  await trigger.click(); assert.equal(await editor.inputValue(), "Original synthetic note");
  await editor.fill("Escape draft"); await page.keyboard.press("Escape"); await waitClosed();
  assert.equal(await page.evaluate(() => window.calls), 0);
  console.log("PASS keyboard opening, focus return, Cancel and Escape without writes");

  await trigger.click(); await editor.fill("  ");
  assert.equal(await page.getByRole("button", { name: "Save", exact: true }).isDisabled(), true);
  await editor.fill("Retained synthetic draft"); await page.evaluate(() => { window.mode = "error"; });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("alert").waitFor(); assert.equal(await editor.inputValue(), "Retained synthetic draft");
  assert.match(await page.getByRole("alert").textContent(), /Synthetic write unavailable/);
  await page.evaluate(() => { window.mode = "ok"; });
  await page.getByRole("button", { name: "Save", exact: true }).click(); await waitClosed();
  assert.equal(await page.getByRole("region", { name: "Timeline" }).getByRole("button").textContent(), "Retained synthetic draftEdit note");
  await page.reload(); await trigger.waitFor();
  assert.match(await trigger.textContent(), /Retained synthetic draft/);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('synthetic-note')).author), "Synthetic Staff");
  console.log("PASS blank validation, failure draft retention, retry, both views, reload and original metadata");

  await trigger.click(); await editor.fill("Duplicate-click draft");
  const before = await page.evaluate(() => window.calls);
  await editor.evaluate(el => {
    el.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    el.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  assert.equal(await page.getByRole("button", { name: "Saving…", exact: true }).isDisabled(), true);
  await page.keyboard.press("Escape"); assert.equal(await dialog.isVisible(), true);
  await waitClosed(); assert.equal(await page.evaluate(() => window.calls), before + 1);
  console.log("PASS duplicate submits issue one write and pending save cannot dismiss");

  await trigger.click(); await editor.fill("Stale synthetic draft");
  await page.evaluate(() => window.concurrentEdit());
  assert.equal(await editor.inputValue(), "Stale synthetic draft");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("alert").waitFor(); assert.match(await page.getByRole("alert").textContent(), /note changed/);
  assert.equal(await editor.inputValue(), "Stale synthetic draft");
  await page.getByRole("button", { name: "Cancel", exact: true }).click(); await waitClosed();
  await trigger.click(); assert.equal(await editor.inputValue(), "Concurrent edit");
  await page.evaluate(() => window.switchScope()); await waitClosed();
  console.log("PASS stale snapshot, conflict draft retention, reopening latest text and scope reset");

  await trigger.click(); await editor.fill('<script>window.injected=true</script>');
  await page.getByRole("button", { name: "Save", exact: true }).click(); await waitClosed();
  assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.match(await trigger.textContent(), /<script>/);
  assert.deepEqual(errors, []);
  console.log("PASS note text renders literally, with no browser errors");
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
