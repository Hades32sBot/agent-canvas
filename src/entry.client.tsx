/**
 * By default, Remix will handle hydrating your app on the client for you.
 * You are free to delete this file if you'd like to, but if you ever want it revealed again, you can run `npx remix reveal` ✨
 * For more information, see https://remix.run/file-conventions/entry.client
 */

import { HydratedRouter } from "react-router/dom";
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import {
  AgentServerUIProviders,
  DEFAULT_AGENT_SERVER_ANALYTICS,
} from "./components/providers";
import { waitForI18n } from "./i18n";
import { shouldStartMockWorker } from "./mocks/should-start-mock-worker";
import { buildAgentCanvasPath } from "#/utils/base-path";

function registerServiceWorker() {
  if (
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator) ||
    !import.meta.env.PROD
  ) {
    return;
  }

  const doRegister = () => {
    navigator.serviceWorker
      .register(buildAgentCanvasPath("/sw.js"))
      .catch((error) => {
        console.error("Service worker registration failed:", error);
      });
  };

  if (document.readyState === "complete") {
    doRegister();
  } else {
    window.addEventListener("load", doRegister, { once: true });
  }
}

async function prepareApp() {
  await waitForI18n();

  if (shouldStartMockWorker()) {
    const { worker } = await import("./mocks/browser");

    await worker.start({
      onUnhandledRequest: "bypass",
    });
  }

  if (import.meta.env.DEV) {
    const { installPendingChatPreview } =
      await import("./dev/seed-pending-chat-preview");
    installPendingChatPreview();
  }

  registerServiceWorker();
}

prepareApp().then(() =>
  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <AgentServerUIProviders
          analytics={DEFAULT_AGENT_SERVER_ANALYTICS}
          withStyleRoot={false}
        >
          <HydratedRouter />
        </AgentServerUIProviders>
      </StrictMode>,
    );
  }),
);
