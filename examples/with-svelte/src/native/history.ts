// Compatibility export for the existing Svelte tests and editor.
// The implementation now lives in the framework-independent element package.
import { CoreEditorHistory } from "@excalidraw/element";
import type { SceneFile } from "./scene";

export class SceneHistory extends CoreEditorHistory<SceneFile> {}
