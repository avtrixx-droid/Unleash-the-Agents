import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const Stage = lazy(() => import("./stage/Stage"));
const Host = lazy(() => import("./host/Host"));
const Join = lazy(() => import("./join/Join"));

const path = window.location.pathname.replace(/\/+$/, "");
const Page = path === "/stage" ? Stage : path === "/host" ? Host : Join;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={<div className="aurora min-h-dvh" />}>
      <Page />
    </Suspense>
  </StrictMode>,
);
