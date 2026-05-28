import { useEffect, useMemo, useState } from "react";

// Module-level registry so the same external script is only injected once
// across all component instances, even as they mount and unmount.
// Key: script src URL; Value: { element, refCount, loaded }
const scriptRegistry = new Map<
  string,
  { script: HTMLScriptElement; count: number; loaded: boolean }
>();

const useScript = (urls: string | string[], condition: boolean = true) => {
  // array of booleans to track the loading state of each script
  const [loadStates, setLoadStates] = useState<boolean[]>();

  const urlArray = useMemo(() => {
    if (!Array.isArray(urls)) {
      return [urls];
    }

    return urls;
  }, [urls]);

  useEffect(() => {
    if (!condition) return;

    // Initialise load-state array, marking already-loaded scripts as done.
    setLoadStates(
      urlArray.map((url) => scriptRegistry.get(url)?.loaded ?? false)
    );

    const entries = urlArray.map((url, idx) => {
      const existing = scriptRegistry.get(url);

      if (existing) {
        // Script is already in the DOM; just bump the ref count.
        existing.count += 1;
        // If it finished loading before we arrived, update state immediately.
        if (existing.loaded) {
          setLoadStates((prev) =>
            prev ? prev.map((s, i) => (i === idx ? true : s)) : prev
          );
        }
        return { url, isNew: false };
      }

      // First consumer of this URL — create and inject the script element.
      const script = document.createElement("script");
      script.src = url;
      script.async = false;
      script.defer = true;

      const onLoad = () => {
        const ref = scriptRegistry.get(url);
        if (ref) ref.loaded = true;
        setLoadStates((prev) =>
          prev ? prev.map((s, i) => (i === idx ? true : s)) : prev
        );
      };
      script.addEventListener("load", onLoad);
      script.addEventListener("error", onLoad);

      scriptRegistry.set(url, { script, count: 1, loaded: false });
      document.head.appendChild(script);

      return { url, isNew: true };
    });

    return () => {
      entries.forEach(({ url }) => {
        const ref = scriptRegistry.get(url);
        if (!ref) return;
        ref.count -= 1;
        // Once a script has executed (loaded=true) it may have registered
        // global singletons (e.g. Google Cast SDK registers the
        // `google-cast-button` custom element). Custom elements can never be
        // un-registered, so attempting to re-execute the script on a future
        // mount would throw `NotSupportedError`. Therefore, loaded scripts
        // are kept permanently in the DOM.
        if (ref.count <= 0 && !ref.loaded) {
          scriptRegistry.delete(url);
          ref.script.parentNode?.removeChild(ref.script);
        }
        // If loaded: leave script + registry entry in place (count stays at
        // 0 until a new consumer increments it again).
      });
    };
  }, [urlArray, condition]);

  return (
    condition &&
    loadStates &&
    (loadStates.length === 0 || loadStates.every((state) => state))
  );
};

export const useCSS = (urls: string | string[], condition?: boolean) => {
  const urlArray = useMemo(() => {
    if (!Array.isArray(urls)) {
      return [urls];
    }

    return urls;
  }, [urls]);

  useEffect(() => {
    const links = urlArray.map((url) => {
      const link = document.createElement("link");

      link.href = url;
      link.rel = "stylesheet";
      link.type = "text/css";
      return link;
    });

    if (condition) {
      links.forEach((link) => {
        document.head.appendChild(link);
      });
    }

    return () => {
      if (condition) {
        links.forEach((link) => {
          document.head.removeChild(link);
        });
      }
    };
  }, [urlArray, condition]);
};

export default useScript;
