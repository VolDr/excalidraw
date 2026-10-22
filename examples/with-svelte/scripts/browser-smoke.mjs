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

  await page.getByRole("button", { name: "Тёмная тема" }).click();
  assert.ok(await page.getByRole("button", { name: "Светлая тема" }).isVisible());
  assert.deepEqual(errors, [], "No uncaught browser errors are expected");
  console.log("Browser smoke passed: native canvas, drawing, duplication, undo, text and JSON export");
} catch (error) {
  await page.screenshot({ path: "/tmp/svelte-smoke-failure.png" }).catch(() => {});
  console.error("Browser smoke failed:", error);
  if (errors.length) {
    console.error("Browser page errors:", errors);
  }
  process.exitCode = 1;
} finally {
  await browser.close();
}
