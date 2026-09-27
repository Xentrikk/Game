import "@fontsource/press-start-2p/400.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setAssetResolver } from "../assets";
import "../styles.css";
import "./demo.css";
import { DemoApp } from "./DemoApp";

// Every sprite sheet and tile image is embedded in the page as a data URL, so the demo is one file.
const embedded = import.meta.glob<string>("../../public/{sprites,tiles,items}/**/*.png", {
  eager: true,
  query: "?inline",
  import: "default",
});
const byPath = new Map(Object.entries(embedded).map(([k, v]) => [k.replace("../../public/", ""), v]));
setAssetResolver((path) => {
  const url = byPath.get(path);
  if (!url) throw new Error(`Missing embedded asset ${path}`);
  return url;
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DemoApp />
  </StrictMode>,
);
