import { mount } from "svelte";

import "@excalidraw/excalidraw/index.css";

import App from "./App.svelte";
import "./app.css";

const target = document.getElementById("app");

if (!target) {
  throw new Error("Missing #app element");
}

mount(App, { target });
