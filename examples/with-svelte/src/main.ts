import { mount } from "svelte";
import App from "./App.svelte";

import "@excalidraw/excalidraw/index.css";
import "./app.css";

const target = document.getElementById("app");

if (!target) {
  throw new Error("Missing #app element");
}

mount(App, { target });
