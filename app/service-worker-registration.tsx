"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator) ||
      !window.isSecureContext
    ) {
      return;
    }

    let registration: ServiceWorkerRegistration | undefined;
    let mounted = true;
    const updateOnReturn = () => {
      if (document.visibilityState !== "visible") return;
      if (registration) {
        void registration.update().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", updateOnReturn);

    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registered) => {
        if (!mounted) return;
        registration = registered;
      })
      .catch((error: unknown) => {
        console.error("Service worker registration failed", error);
      });

    return () => {
      mounted = false;
      document.removeEventListener("visibilitychange", updateOnReturn);
    };
  }, []);

  return null;
}
