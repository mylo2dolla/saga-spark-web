import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { DEV_FINGERPRINT } from "./devFingerprint";

const DEV_DEBUG = import.meta.env.DEV;
const devWindow = window as Window & {
  __devFetchWrapped?: boolean;
  __devFetchBase?: typeof fetch;
};

console.log("[env] DEV_FINGERPRINT", DEV_FINGERPRINT);

if (DEV_DEBUG && !devWindow.__devFetchWrapped) {
  devWindow.__devFetchWrapped = true;
  devWindow.__devFetchBase = window.fetch.bind(window);

  const resolveFetchUrl = (input: RequestInfo | URL): string => {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    if (typeof Request !== "undefined" && input instanceof Request) return input.url;
    const maybe = input as { url?: string; href?: string };
    return maybe.url ?? maybe.href ?? "";
  };

  window.fetch = async (...args) => {
    const [input, init] = args;
    const url = resolveFetchUrl(input);
    const method = init?.method ?? "GET";
    if (url && url.includes("supabase.co")) {
      console.info("DEV_DEBUG fetch start", { method, url });
    }

    try {
      const response = await devWindow.__devFetchBase!(input, init);
      if (url && url.includes("supabase.co")) {
        console.info("DEV_DEBUG fetch response", {
          method,
          url,
          status: response.status,
        });
      }
      return response;
    } catch (error) {
      if (url && url.includes("supabase.co")) {
        console.error("DEV_DEBUG fetch error", { method, url, error });
      }
      throw error;
    }
  };
}

createRoot(document.getElementById("root")!).render(<App />);
