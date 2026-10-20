import type { SceneFile } from "./scene";

const MAX_UNDO = 100;

/**
 * Framework-independent, whole-scene undo/redo for native Svelte edits.
 * A snapshot is recorded once per completed gesture, not per pointer move.
 * This is intentionally separate from React Excalidraw's internal history.
 */
export class SceneHistory {
  private past: SceneFile[] = [];
  private future: SceneFile[] = [];

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  commit(previous: SceneFile) {
    this.past.push(structuredClone(previous));
    if (this.past.length > MAX_UNDO) {
      this.past.shift();
    }
    this.future = [];
  }

  undo(current: SceneFile): SceneFile {
    const previous = this.past.pop();
    if (!previous) {
      return current;
    }
    this.future.push(structuredClone(current));
    return previous;
  }

  redo(current: SceneFile): SceneFile {
    const next = this.future.pop();
    if (!next) {
      return current;
    }
    this.past.push(structuredClone(current));
    return next;
  }

  clear() {
    this.past = [];
    this.future = [];
  }
}
