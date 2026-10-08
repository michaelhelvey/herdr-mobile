import "./styles.css";

import { render } from "preact";

import { App } from "./app.tsx";
import { bridgeUrl, connect } from "./client/connection.ts";

const root = document.getElementById("app");

if (root) {
  render(<App />, root);
}

connect(bridgeUrl(window.location));

// Re-run this module when a module that it imports changes, so that the page does not reload.
import.meta.hot.accept();
