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

  // Attach a label to the existing independent rectangle in native mode.
  const rect = imported.elements.find(
    (element) => element.type === "rectangle" && !element.isDeleted,
  );
  assert.ok(rect, "Imported scene must include a rectangle");
  const cx = area.x + rect.x + rect.width / 2;
  const cy = area.y + rect.y + rect.height / 2;
  await page.mouse.dblclick(cx, cy);
  await input.waitFor();
  await input.fill("Bound text\nInside rectangle");
  await input.press("Control+Enter");
  await input.waitFor({ state: "hidden" });
  let withLabel = await saveScene();
  const labeledBox = withLabel.elements.find((element) => element.id === rect.id);
  assert.equal(labeledBox.boundElements.length, 1);
  const boundId = labeledBox.boundElements[0].id;
  assert.equal(labeledBox.boundElements[0].type, "text");
  const firstLabel = withLabel.elements.find((element) => element.id === boundId);
  assert.equal(firstLabel.containerId, rect.id);
  assert.equal(firstLabel.originalText, "Bound text\nInside rectangle");

  // Update the reciprocal bound label and restore it using undo.
  await page.mouse.dblclick(cx, cy);
  await input.waitFor();
  assert.equal(await input.inputValue(), firstLabel.originalText);
  await input.fill("Edited bound text");
  await input.press("Control+Enter");
  await input.waitFor({ state: "hidden" });
  withLabel = await saveScene();
  assert.equal(
    withLabel.elements.find((element) => element.id === boundId).originalText,
    "Edited bound text",
  );
  assert.equal(withLabel.elements.find((element) => element.id === boundId).version,
    firstLabel.version + 1);
  await page.locator(".native-viewport").press("Control+z");
  withLabel = await saveScene();
  assert.equal(
    withLabel.elements.find((element) => element.id === boundId).originalText,
    firstLabel.originalText,
  );

  // Duplicating a labeled shape must clone and relink its label, not point
  // the new container back to the original text.
  await page.mouse.click(cx, cy);
  await page.locator(".native-viewport").press("Control+d");
  const withCopy = await saveScene();
  const copiedBox = withCopy.elements.find(
    (element) =>
      element.type === "rectangle" &&
      element.id !== rect.id &&
      !element.isDeleted,
  );
  assert.ok(copiedBox, "Duplicated box must be saved");
  assert.equal(copiedBox.boundElements?.length, 1);
  const copiedLabel = withCopy.elements.find(
    (element) => element.id === copiedBox.boundElements[0].id,
  );
  assert.ok(copiedLabel, "Duplicated label must be saved");
  assert.notEqual(copiedLabel.id, boundId);
  assert.equal(copiedLabel.containerId, copiedBox.id);
  assert.equal(copiedLabel.originalText, firstLabel.originalText);
  assert.equal(
    withCopy.elements.find((element) => element.id === rect.id)
      .boundElements[0].id,
    boundId,
  );
  await page.locator(".native-viewport").press("Control+z");
  const restored = await saveScene();
  assert.deepEqual(restored, withLabel);

  // A native flat group must include the bound label as an internal member.
  await page.getByRole("button", { name: "Эллипс" }).click();
  await page.mouse.move(x + 370, y + 10);
  await page.mouse.down();
  await page.mouse.move(x + 455, y + 95, { steps: 5 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Выделение" }).click();
  await page.locator(".native-viewport").press("Control+a");
  await page.locator(".native-viewport").press("Control+g");
  const groupedScene = await saveScene();
  const originalGroupedBox = groupedScene.elements.find((e) => e.id === rect.id);
  const originalGroupedLabel = groupedScene.elements.find((e) => e.id === boundId);
  assert.ok(originalGroupedBox.groupIds.length === 1);
  const groupId = originalGroupedBox.groupIds[0];
  assert.deepEqual(originalGroupedLabel.groupIds, [groupId]);
  assert.ok(
    groupedScene.elements.filter((e) => !e.isDeleted && e.groupIds.includes(groupId)).length >= 3,
  );

  // Import/export a grouped scene without losing reciprocal links or group IDs.
  await page.locator(".toolbar input[type=file]").setInputFiles({
    name: "grouped.excalidraw",
    mimeType: "application/vnd.excalidraw+json",
    buffer: Buffer.from(JSON.stringify(groupedScene)),
  });
  await page.getByText("Открыт файл: grouped.excalidraw").waitFor();
  assert.deepEqual(await saveScene(), groupedScene);

  await page.mouse.click(cx, cy);
  await page.locator(".native-viewport").press("Control+d");
  const duplicatedGroup = await saveScene();
  const groupCopy = duplicatedGroup.elements.find(
    (e) => e.type === "rectangle" && e.id !== rect.id && !e.isDeleted,
  );
  assert.ok(groupCopy, "Whole-group duplication must copy the bound box");
  assert.notEqual(groupCopy.groupIds[0], groupId);
  const copiedGroupLabel = duplicatedGroup.elements.find(
    (e) => e.id === groupCopy.boundElements?.[0]?.id,
  );
  assert.ok(copiedGroupLabel);
  assert.equal(copiedGroupLabel.containerId, groupCopy.id);
  assert.deepEqual(copiedGroupLabel.groupIds, groupCopy.groupIds);
  assert.equal(
    duplicatedGroup.elements.find((e) => e.id === rect.id).boundElements[0].id,
    boundId,
  );
  await page.locator(".native-viewport").press("Control+z");
  assert.deepEqual(await saveScene(), groupedScene);

  // After undo resets the selection, select the group and ungroup it.
  await page.mouse.click(cx, cy);
  await page.locator(".native-viewport").press("Control+Shift+g");
  const ungroupedScene = await saveScene();
  assert.ok(ungroupedScene.elements.every((e) => e.groupIds.length === 0));
  assert.equal(
    ungroupedScene.elements.find((e) => e.id === boundId).containerId,
    rect.id,
  );
  assert.equal(
    ungroupedScene.elements.find((e) => e.id === rect.id).boundElements[0].id,
    boundId,
  );
  // Resize and rotate a supported two-root group through visible handles.
  const ungroupedEllipse = ungroupedScene.elements.find(
    (e) => e.type === "ellipse" && !e.isDeleted,
  );
  assert.ok(ungroupedEllipse);
  await page.mouse.click(cx, cy);
  await page.mouse.click(
    area.x + ungroupedEllipse.x + ungroupedEllipse.width / 2,
    area.y + ungroupedEllipse.y + ungroupedEllipse.height / 2,
    { modifiers: ["Shift"] },
  );
  await page.locator(".native-viewport").press("Control+g");
  const transformStart = await saveScene();
  const sourceBox = transformStart.elements.find((e) => e.id === rect.id);
  const sourceEllipse = transformStart.elements.find((e) => e.id === ungroupedEllipse.id);
  assert.deepEqual(sourceBox.groupIds, sourceEllipse.groupIds);
  const left = Math.min(sourceBox.x, sourceEllipse.x);
  const top = Math.min(sourceBox.y, sourceEllipse.y);
  const right = Math.max(
    sourceBox.x + sourceBox.width,
    sourceEllipse.x + sourceEllipse.width,
  );
  const bottom = Math.max(
    sourceBox.y + sourceBox.height,
    sourceEllipse.y + sourceEllipse.height,
  );

  await page.mouse.move(area.x + right, area.y + bottom);
  await page.mouse.down();
  await page.mouse.move(area.x + right + 60, area.y + bottom + 35, {
    steps: 8,
  });
  await page.mouse.up();
  const scaledGroup = await saveScene();
  const scaledBox = scaledGroup.elements.find((e) => e.id === rect.id);
  const scaledEllipse = scaledGroup.elements.find((e) => e.id === ungroupedEllipse.id);
  const scaledLabel = scaledGroup.elements.find((e) => e.id === boundId);
  assert.ok(scaledBox.width > sourceBox.width);
  assert.ok(scaledEllipse.width > sourceEllipse.width);
  assert.equal(scaledLabel.containerId, rect.id);
  assert.deepEqual(scaledLabel.groupIds, scaledBox.groupIds);
  await page.locator(".native-viewport").press("Control+z");
  assert.deepEqual(await saveScene(), transformStart);

  // Undo clears selection; reselect the group before dragging its rotation handle.
  await page.mouse.click(cx, cy);
  const midX = (left + right) / 2;
  const midY = (top + bottom) / 2;
  await page.mouse.move(area.x + midX, area.y + top - 28);
  await page.mouse.down();
  await page.mouse.move(area.x + midX + 170, area.y + midY, { steps: 8 });
  await page.mouse.up();
  const rotatedGroup = await saveScene();
  const rotatedBox = rotatedGroup.elements.find((e) => e.id === rect.id);
  const rotatedLabel = rotatedGroup.elements.find((e) => e.id === boundId);
  assert.ok(Math.abs(rotatedBox.angle) > 0.1);
  assert.ok(Math.abs(rotatedBox.angle - rotatedLabel.angle) < 0.0001);
  assert.equal(rotatedLabel.containerId, rect.id);
  await page.locator(".native-viewport").press("Control+z");
  assert.deepEqual(await saveScene(), transformStart);
  assert.deepEqual(errors, []);

  // A self-contained .excalidraw import exercises a simple, unbound arrow
  // independently of the more complex labeled group above.
  const linearBox = {
    ...structuredClone(sourceBox),
    id: "smoke-simple-box",
    x: 90,
    y: 120,
    width: 100,
    height: 80,
    angle: 0,
    groupIds: [],
    boundElements: null,
  };
  const linearArrow = {
    ...structuredClone(linearBox),
    id: "smoke-simple-arrow",
    type: "arrow",
    x: 260,
    y: 130,
    width: 110,
    height: 80,
    points: [[0, 0], [110, 80]],
    startBinding: null,
    endBinding: null,
    elbowed: false,
    startArrowhead: null,
    endArrowhead: "arrow",
  };
  const linearScene = {
    ...transformStart,
    elements: [linearBox, linearArrow],
  };
  await page.locator(".toolbar input[type=file]").setInputFiles({
    name: "simple-linear-group.excalidraw",
    mimeType: "application/vnd.excalidraw+json",
    buffer: Buffer.from(JSON.stringify(linearScene)),
  });
  await page.getByText("Открыт файл: simple-linear-group.excalidraw").waitFor();
  await page.locator(".native-viewport").press("Control+a");
  await page.locator(".native-viewport").press("Control+g");
  const linearGrouped = await saveScene();
  assert.deepEqual(
    linearGrouped.elements[0].groupIds,
    linearGrouped.elements[1].groupIds,
  );
  assert.equal(linearGrouped.elements[0].groupIds.length, 1);
  await page.mouse.move(area.x + 370, area.y + 210);
  await page.mouse.down();
  await page.mouse.move(area.x + 445, area.y + 260, { steps: 8 });
  await page.mouse.up();
  const linearScaled = await saveScene();
  const scaledArrow = linearScaled.elements[1];
  assert.ok(scaledArrow.width > linearArrow.width);
  assert.ok(scaledArrow.points[1][0] > linearArrow.points[1][0]);
  assert.ok(scaledArrow.points[1][1] > linearArrow.points[1][1]);
  assert.equal(scaledArrow.startBinding, null);
  assert.equal(scaledArrow.endBinding, null);
  await page.locator(".native-viewport").press("Control+z");
  assert.deepEqual(await saveScene(), linearGrouped);

  await page.mouse.click(area.x + 140, area.y + 160);
  await page.mouse.move(area.x + 230, area.y + 92);
  await page.mouse.down();
  await page.mouse.move(area.x + 370, area.y + 165, { steps: 8 });
  await page.mouse.up();
  const linearRotated = await saveScene();
  assert.ok(Math.abs(linearRotated.elements[1].angle) > 0.1);
  assert.deepEqual(linearRotated.elements[1].points, linearArrow.points);
  assert.deepEqual(linearRotated.elements[0].groupIds, linearRotated.elements[1].groupIds);
  assert.deepEqual(errors, []);

  await page.getByRole("button", { name: "Тёмная тема" }).click();
  assert.ok(await page.getByRole("button", { name: "Светлая тема" }).isVisible());
  assert.deepEqual(errors, [], "No uncaught browser errors are expected");
  console.log("Browser smoke passed: native canvas, bound groups, resize, rotation, undo, text and JSON export");
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
