import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { DEV_FINGERPRINT } from "./devFingerprint";

const DEV_DEBUG = import.meta.env.DEV;
const DEV_FETCH_DEBUG = import.meta.env.VITE_DEBUG_FETCH === "true";
const devWindow = window as Window & {
  __devFetchWrapped?: boolean;
  __devFetchBase?: typeof fetch;
};

console.log("[env] DEV_FINGERPRINT", DEV_FINGERPRINT);

if (DEV_DEBUG && DEV_FETCH_DEBUG && !devWindow.__devFetchWrapped) {
  devWindow.__devFetchWrapped = true;
  devWindow.__devFetchBase = window.fetch.bind(window);

  window.fetch = async (...args) => {
    const [input, init] = args;
    const url = typeof input === "string" ? input : input.url;
    const method = init?.method ?? "GET";
    if (url.includes("supabase.co")) {
      console.info("DEV_DEBUG fetch start", { method, url });
    }

    try {
      const response = await devWindow.__devFetchBase!(input, init);
      if (url.includes("supabase.co")) {
        console.info("DEV_DEBUG fetch response", {
          method,
          url,
          status: response.status,
        });
      }
      return response;
    } catch (error) {
      if (url.includes("supabase.co")) {
        console.error("DEV_DEBUG fetch error", { method, url, error });
      }
      throw error;
    }
  };
}

createRoot(document.getElementById("root")!).render(<App />);
