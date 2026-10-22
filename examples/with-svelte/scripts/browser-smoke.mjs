import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The browser dependency is installed into an isolated CI temp directory,
// rather than changing the application's lockfile or production dependencies.
const { chromium } = await import(process.env.PLAYWRIGHT_ENTRY ?? "playwright");

const url = process.env.SVELTE_SMOKE_URL ?? "http://127.0.0.1:3008";
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];

page.on("pageerror", (error) => errors.push(error.message));

const saveScene = async () => {
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Сохранить" }).click();
  const download = await downloadEvent;
  const savedPath = await download.path();
  assert.ok(savedPath, "Browser should produce a downloadable document");
  return JSON.parse(await readFile(savedPath, "utf8"));
};

try {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.locator(".native-viewport canvas").waitFor();
  await page.waitForFunction(() => {
    const canvas = document.querySelector(".native-viewport canvas");
    return canvas && canvas.width > 300 && canvas.height > 200;
  });
  assert.ok(
    await page.getByText("Нативный Canvas", { exact: true }).isVisible(),
    "Svelte native editor should be the default view",
  );

  const area = await page.locator(".native-viewport").boundingBox();
  assert.ok(area && area.width > 400 && area.height > 300);
  const x = area.x + 115;
  const y = area.y + 115;

  await page.getByRole("button", { name: "Прямоугольник" }).click();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 145, y + 95, { steps: 6 });
  await page.mouse.up();

  let scene = await saveScene();
  assert.equal(scene.elements.filter((e) => !e.isDeleted && e.type === "rectangle").length, 1);
  assert.equal(scene.elements[0].width, 145);
  assert.equal(scene.elements[0].height, 95);

  await page.getByRole("button", { name: "Выделение" }).click();
  await page.mouse.click(x + 50, y + 50);
  await page.locator(".native-viewport").press("Control+d");
  scene = await saveScene();
  assert.equal(scene.elements.filter((e) => !e.isDeleted && e.type === "rectangle").length, 2);

  await page.locator(".native-viewport").press("Control+z");
  scene = await saveScene();
  assert.equal(scene.elements.filter((e) => !e.isDeleted && e.type === "rectangle").length, 1);

  await page.getByRole("button", { name: "Текст", exact: true }).click();
  await page.mouse.click(x + 275, y + 175);
  const input = page.getByRole("textbox", { name: "Редактировать текст" });
  await input.waitFor();
  await input.fill("Hello\nWorld");
  await input.press("Control+Enter");
  await input.waitFor({ state: "hidden" });

  scene = await saveScene();
  const texts = scene.elements.filter((e) => !e.isDeleted && e.type === "text");
  assert.equal(texts.length, 1);
  assert.equal(texts[0].text, "Hello\nWorld");
  assert.ok(texts[0].height > texts[0].fontSize);
  assert.ok(texts[0].width > 0);
  const originalText = texts[0];

  // Edit the existing text rather than creating another text element.
  await page.mouse.dblclick(x + 289, y + 184);
  await input.waitFor();
  assert.equal(await input.inputValue(), "Hello\nWorld");
  await input.fill("Edited text\nSecond line");
  await input.press("Control+Enter");
  await input.waitFor({ state: "hidden" });

  scene = await saveScene();
  const edited = scene.elements.find((e) => e.id === originalText.id);
  assert.ok(edited);
  assert.equal(edited.text, "Edited text\nSecond line");
  assert.equal(edited.originalText, "Edited text\nSecond line");
  assert.equal(edited.version, originalText.version + 1);
  assert.equal(scene.elements.filter((e) => !e.isDeleted && e.type === "text").length, 1);

  // Reopening and committing unchanged text must not produce a new revision.
  await page.mouse.dblclick(x + 289, y + 184);
  await input.waitFor();
  await input.press("Control+Enter");
  await input.waitFor({ state: "hidden" });
  scene = await saveScene();
  assert.equal(scene.elements.find((e) => e.id === edited.id).version, edited.version);

  // Text edits form one undo/redo transaction.
  await page.locator(".native-viewport").press("Control+z");
  scene = await saveScene();
  assert.equal(scene.elements.find((e) => e.id === edited.id).text, "Hello\nWorld");
  await page.locator(".native-viewport").press("Control+y");
  scene = await saveScene();
  assert.equal(scene.elements.find((e) => e.id === edited.id).text, edited.text);

  // Roundtrip via the real file-import UI, preserving metadata and identities.
  const exported = structuredClone(scene);
  await page.locator(".toolbar input[type=file]").setInputFiles({
    name: "roundtrip.excalidraw",
    mimeType: "application/vnd.excalidraw+json",
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await page.getByText("Открыт файл: roundtrip.excalidraw").waitFor();
  const imported = await saveScene();
  assert.deepEqual(imported, exported);
  assert.deepEqual(errors, []);

  await page.getByRole("button", { name: "Тёмная тема" }).click();
  assert.ok(await page.getByRole("button", { name: "Светлая тема" }).isVisible());
  assert.deepEqual(errors, [], "No uncaught browser errors are expected");
  console.log("Browser smoke passed: native canvas, drawing, duplication, undo, text and JSON export");
} catch (error) {
  await page.screenshot({ path: "/tmp/svelte-smoke-failure.png" }).catch(() => {});
  console.error("Browser smoke failed:", error);
  console.error("DOM state:", await page.evaluate(() => ({
    active: document.activeElement?.tagName,
    textInputs: document.querySelectorAll(".text-input").length,
    toolButtons: [...document.querySelectorAll(".native-toolbar button.active")]
      .map((button) => button.textContent?.trim()),
  })).catch(() => ({})));
  if (errors.length) {
    console.error("Browser page errors:", errors);
  }
  process.exitCode = 1;
} finally {
  await browser.close();
}
