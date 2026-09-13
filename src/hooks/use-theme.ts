import { useEffect, useState } from "react";

export function useIsDarkTheme() {
  const getIsDark = () => {
    if (typeof document === "undefined") return true; // SSR default to dark
    if (document.documentElement.classList.contains("dark")) return true;
    const stored = localStorage.getItem("atlas-theme");
    if (stored === "dark") return true;
    if (stored === "light") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  };

  const [isDark, setIsDark] = useState(getIsDark);

  useEffect(() => {
    // Initial check right after hydration
    setIsDark(getIsDark());

    // Observer to watch for class changes on html tag
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  return isDark;
}
