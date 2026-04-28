import compression from "compression";
import express from "express";
import morgan from "morgan";
import path from "node:path";
import { createRequestHandler } from "@react-router/express";

import * as build from "./build/server/index.js";

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST;
const clientBuildDirectory = path.resolve("build/client");

const app = express();

function setAssetHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
}

app.disable("x-powered-by");
app.use(compression());

app.use(
  "/assets",
  express.static(path.join(clientBuildDirectory, "assets"), {
    immutable: true,
    maxAge: "1y",
    setHeaders: setAssetHeaders,
  }),
);
app.use(
  express.static(clientBuildDirectory, {
    maxAge: "1h",
    setHeaders: setAssetHeaders,
  }),
);
app.use(express.static("public", { maxAge: "1h" }));
app.use(morgan("tiny"));

app.all(
  "*",
  createRequestHandler({
    build,
    mode: process.env.NODE_ENV,
  }),
);

const onListen = () => {
  const address = host || "localhost";
  console.log(`[server] http://${address}:${port}`);
};

if (host) {
  app.listen(port, host, onListen);
} else {
  app.listen(port, onListen);
}
