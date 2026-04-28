import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { type EntryContext } from "react-router";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";

export const streamTimeout = 5000;

const APP_PROXY_PATH = "/apps/account-page-proxy";

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext,
) {
  addDocumentResponseHeaders(request, responseHeaders);
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";
  const { pathname } = new URL(request.url);
  const isAppProxyDocument = pathname.startsWith(APP_PROXY_PATH);

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <div id="app-root">
        <ServerRouter context={reactRouterContext} url={request.url} />
      </div>,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set(
            "Content-Type",
            isAppProxyDocument
              ? "application/liquid"
              : "text/html; charset=utf-8",
          );
          responseHeaders.set("Access-Control-Allow-Origin", "*");
          responseHeaders.set("Access-Control-Allow-Methods", "GET, OPTIONS");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
          pipe(body);
        },
        onShellError(error) {
          console.error("[entry.server] onShellError:", error);
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          console.error("[entry.server] onError:", error);
        },
      },
    );

    // Automatically timeout the React renderer after 6 seconds, which ensures
    // React has enough time to flush down the rejected boundary contents
    setTimeout(abort, streamTimeout + 1000);
  });
}
