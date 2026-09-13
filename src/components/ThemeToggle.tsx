import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const [dark, setDark] = useState(() => {
    if (typeof document === "undefined") return true;
    const stored = localStorage.getItem("atlas-theme");
    if (stored === "dark") return true;
    if (stored === "light") return false;
    return document.documentElement.classList.contains("dark") || window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    // Sync initially with localStorage and html class to prevent hydration mismatch flash
    const stored = localStorage.getItem("atlas-theme");
    const isDark = stored === "dark" || (stored !== "light" && (
      document.documentElement.classList.contains("dark") || window.matchMedia("(prefers-color-scheme: dark)").matches
    ));
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);

    // Listen for OS/browser preference changes
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem("atlas-theme")) {
        const next = e.matches;
        setDark(next);
        document.documentElement.classList.toggle("dark", next);
      }
    };
    
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  const toggle = () => {
    const next = !dark;
    const applyTheme = () => {
      setDark(next);
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("atlas-theme", next ? "dark" : "light");
    };

    // Use a clean, elegant view transition animation if supported by the browser
    if (!document.startViewTransition) {
      applyTheme();
    } else {
      document.startViewTransition(() => {
        applyTheme();
      });
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label="Toggle theme"
      className="rounded-full overflow-hidden transition-all duration-300 relative"
    >
      <Sun className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-4 w-4 transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] ${dark ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-90 scale-50'}`} />
      <Moon className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-4 w-4 transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] ${dark ? 'opacity-0 rotate-90 scale-50' : 'opacity-100 rotate-0 scale-100'}`} />
    </Button>
  );
}
