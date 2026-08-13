import { useState, useDeferredValue, useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { searchMemories } from "@/lib/memories";
import { Compass, Loader2, LogIn, LogOut, Search, Sparkles, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ThemeToggle } from "./ThemeToggle";
import { useAppStore } from "@/lib/store";
import { login, signup, loginWithGoogle, logout } from "@/lib/auth";

import type { WSStatus } from "@/lib/ws";
import { cn } from "@/lib/utils";

export function Header({
  wsStatus,
  onSearch,
}: {
  wsStatus: WSStatus;
  onSearch: (q: string) => void;
}) {
  const user = useAppStore((s) => s.user);
  const openClusterKey = useAppStore((s) => s.openClusterKey);
  const setActiveSearchPopupId = useAppStore((s) => s.setActiveSearchPopupId);
  const setActiveSearchMemory = useAppStore((s) => s.setActiveSearchMemory);
  const isPickingLocation = useAppStore((s) => s.isPickingLocation);
  const setIsPickingLocation = useAppStore((s) => s.setIsPickingLocation);
  const isDrawerOpen = !!openClusterKey;
  const initials = user?.name?.slice(0, 2).toUpperCase() ?? "?";

  const [searchQuery, setSearchQuery] = useState("");
  const deferredQuery = useDeferredValue(searchQuery);

  const { data: searchResults, isFetching } = useQuery({
    queryKey: ["search", deferredQuery],
    queryFn: () => searchMemories(deferredQuery),
    enabled: deferredQuery.length > 0,
  });

  const [selectedIndex, setSelectedIndex] = useState(-1);
  useEffect(() => {
    setSelectedIndex(-1);
  }, [searchResults]);

  const searchContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setSearchQuery("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const statusMap: Record<WSStatus, { color: string; label: string }> = {
    idle: { color: "bg-muted-foreground/60", label: "Sign in required" },
    connecting: { color: "bg-yellow-500 animate-pulse", label: "Connecting" },
    open: { color: "bg-success animate-pulse", label: "Live Pipeline" },
    closed: { color: "bg-destructive", label: "Offline" },
  };
  const status = statusMap[wsStatus];

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || (isSignUp && !name)) return;
    setLoading(true);
    try {
      if (isSignUp) {
        const res = await signup(name, email, password);
        toast.success(`Account created! Welcome, ${res.user.name}!`);
      } else {
        const res = await login(email, password);
        toast.success(`Welcome back, ${res.user.name}!`);
      }
      setPopoverOpen(false);
      setName("");
      setEmail("");
      setPassword("");
    } catch (err) {
      toast.error((err as Error).message || (isSignUp ? "Sign up failed" : "Sign in failed"));
    } finally {
      setLoading(false);
    }
  };



  return (
    <header
      className={cn(
        "pointer-events-none fixed inset-x-0 top-0 z-[500] flex justify-center px-3 pt-3 transition-all duration-300 ease-in-out sm:px-6 sm:pt-5",
        isDrawerOpen && "hidden sm:flex sm:opacity-100 sm:translate-y-0"
      )}
    >
      <div
        className={cn(
          "glass pointer-events-auto flex w-full items-center gap-2 rounded-2xl px-3 py-2 transition-all duration-300 ease-in-out sm:gap-3 sm:px-4",
          isDrawerOpen ? "max-w-xl sm:max-w-2xl pointer-events-none sm:pointer-events-auto" : "max-w-5xl"
        )}
      >
        <Link to="/" className="flex items-center gap-2 pr-1 sm:pr-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl gradient-accent text-primary-foreground shadow">
            <Compass className="h-4 w-4" />
          </span>
          <span
            className={cn(
              "font-display text-lg font-semibold tracking-tight transition-all duration-300 ease-in-out overflow-hidden whitespace-nowrap",
              isDrawerOpen
                ? "max-w-0 opacity-0 w-0 pointer-events-none hidden md:block md:max-w-xs md:opacity-100 md:w-auto"
                : "max-w-xs opacity-100 hidden sm:block"
            )}
          >
            WayPoint
          </span>
        </Link>

        <div className="relative flex-1 h-8 sm:h-9">
          {/* Pick Location Banner */}
          <div
            className={cn(
              "absolute inset-0 flex items-center justify-between bg-muted/40 rounded-xl px-2 sm:px-3 transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] origin-left",
              isPickingLocation ? "opacity-100 scale-100 translate-y-0 pointer-events-auto" : "opacity-0 scale-[0.98] translate-y-1 pointer-events-none"
            )}
          >
            <div className="flex items-center justify-center flex-1 gap-2 sm:gap-2.5 overflow-hidden px-1">
              <span className="relative flex h-2 w-2 items-center justify-center shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/40 opacity-75"></span>
                <span className="relative inline-flex h-1 w-1 rounded-full bg-primary"></span>
              </span>
              <span className="text-[11px] sm:text-[13px] font-medium text-foreground/70 truncate font-display tracking-wide">
                Click anywhere on the map
              </span>
            </div>
            <button
              onClick={() => setIsPickingLocation(false)}
              className="flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-full hover:bg-background/80 text-muted-foreground hover:text-foreground transition-all cursor-pointer shrink-0 ml-1 sm:ml-2"
              title="Cancel"
            >
              <X className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>
          </div>

          {/* Search Bar */}
          <div
            className={cn(
              "absolute inset-0 transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] origin-left",
              !isPickingLocation ? "opacity-100 scale-100 translate-y-0 pointer-events-auto" : "opacity-0 scale-[0.98] -translate-y-1 pointer-events-none"
            )}
            ref={searchContainerRef}
          >
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground sm:left-3 sm:h-4 sm:w-4" />
            <Input
              placeholder="Search places, memories…"
              className="h-8 rounded-xl border-transparent bg-background/50 pl-8 text-xs sm:h-9 sm:pl-9 sm:text-sm focus-visible:border-primary/40"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                onSearch(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearchQuery("");
                  e.currentTarget.blur();
                  return;
                }
                if (!searchResults || searchResults.length === 0) return;
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSelectedIndex((prev) => Math.min(prev + 1, searchResults.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSelectedIndex((prev) => Math.max(prev - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (selectedIndex >= 0 && selectedIndex < searchResults.length) {
                    setActiveSearchPopupId(searchResults[selectedIndex].id);
                    setActiveSearchMemory(searchResults[selectedIndex]);
                    setSearchQuery("");
                    setSelectedIndex(-1);
                  } else if (searchResults.length > 0) {
                    setActiveSearchPopupId(searchResults[0].id);
                    setActiveSearchMemory(searchResults[0]);
                    setSearchQuery("");
                    setSelectedIndex(-1);
                  }
                }
              }}
            />
            {searchQuery.length > 0 && (
              <div className="absolute top-full mt-2 w-full bg-card border border-border shadow-lg rounded-xl overflow-hidden z-50">
                {isFetching ? (
                  <div className="p-3 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" /> Searching...
                  </div>
                ) : searchResults && searchResults.length > 0 ? (
                  <div className="max-h-[50vh] overflow-y-auto py-1">
                    {searchResults.map((result, idx) => (
                      <button
                        key={result.id}
                        className={cn(
                          "w-full text-left px-3 py-1.5 transition-colors flex items-center justify-between gap-3 group",
                          idx === selectedIndex ? "bg-muted/80" : "hover:bg-muted/50"
                        )}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        onClick={() => {
                          setActiveSearchPopupId(result.id);
                          setActiveSearchMemory(result);
                          setSearchQuery("");
                          setSelectedIndex(-1);
                        }}
                      >
                        <div className="flex flex-col overflow-hidden">
                          <span className="text-[13px] font-medium text-foreground group-hover:text-primary transition-colors truncate">{result.title}</span>
                          <span className="text-[10px] text-muted-foreground truncate">{result.locationTag || result.narrative}</span>
                        </div>
                        <span className="text-[10px] font-mono text-muted-foreground/40 shrink-0 tabular-nums">
                          {result.lat.toFixed(3)}°, {result.lng.toFixed(3)}°
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 text-center text-xs text-muted-foreground">No places found.</div>
                )}
              </div>
            )}
          </div>
        </div>

        <div
          className={cn(
            "flex items-center gap-2 sm:gap-3 transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] shrink-0 overflow-hidden",
            isPickingLocation 
              ? "max-w-0 opacity-0 scale-95 pointer-events-none md:max-w-xs md:opacity-100 md:scale-100 md:pointer-events-auto" 
              : "max-w-xs opacity-100 scale-100 pointer-events-auto"
          )}
        >
          <div
            title={`Real-Time Stream: ${status.label}`}
            className="hidden items-center justify-center sm:flex px-1 shrink-0"
          >
            <span className={`h-2 w-2 rounded-full ${status.color}`} />
          </div>

          <div className="shrink-0 flex items-center">
            <ThemeToggle />
          </div>

          <div className="shrink-0 flex items-center">
          {user ? (
            <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full cursor-pointer">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-primary/15 text-xs text-primary font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 glass rounded-2xl p-1.5">
              <DropdownMenuLabel className="px-3 py-2">
                <div className="text-sm font-semibold text-foreground">{user.name}</div>
                <div className="truncate text-xs font-normal text-muted-foreground">{user.email}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="my-1" />
              <DropdownMenuItem
                onClick={logout}
                className="rounded-xl px-3 py-2 text-xs font-medium text-destructive focus:bg-destructive/10 focus:text-destructive cursor-pointer"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" className="rounded-full gradient-accent text-primary-foreground shadow-sm transition-all hover:opacity-95 active:scale-95 cursor-pointer">
                <LogIn className="mr-1.5 h-3.5 w-3.5" />
                Sign in
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={10}
              className="glass pointer-events-auto w-80 rounded-2xl p-5 shadow-2xl border border-border/60 backdrop-blur-2xl"
            >
              <div className="space-y-4">
                <div className="flex rounded-xl bg-muted/60 p-1 border border-border/40">
                  <button
                    type="button"
                    onClick={() => setIsSignUp(false)}
                    className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-all cursor-pointer ${!isSignUp ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"
                      }`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsSignUp(true)}
                    className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-all cursor-pointer ${isSignUp ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"
                      }`}
                  >
                    Sign Up
                  </button>
                </div>

                <div className="space-y-1 text-center">
                  <h4 className="font-display text-sm font-semibold tracking-tight">
                    {isSignUp ? "Create a WayPoint Account" : "Sign in to WayPoint"}
                  </h4>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {isSignUp
                      ? "Create an account to save spatial memories."
                      : "Enter your credentials to access your places."}
                  </p>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={loginWithGoogle}
                  className="w-full h-8 text-xs border-border/60 bg-background/50 hover:bg-accent/40 cursor-pointer flex items-center justify-center"
                >
                  <svg className="mr-2 h-3.5 w-3.5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                  </svg>
                  {isSignUp ? "Sign up with Google" : "Sign in with Google"}
                </Button>

                <div className="relative my-2">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-border/50" />
                  </div>
                  <div className="relative flex justify-center text-[10px] uppercase">
                    <span className="bg-background/80 px-2 text-muted-foreground">Or email</span>
                  </div>
                </div>

                <form onSubmit={handleAuth} className="space-y-3">
                  {isSignUp && (
                    <div className="space-y-1">
                      <Label htmlFor="dropdown-name" className="text-[11px] font-medium text-muted-foreground">
                        Full Name
                      </Label>
                      <Input
                        id="dropdown-name"
                        type="text"
                        required
                        placeholder="Alex Morgan"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="h-9 rounded-xl bg-background/60 text-xs border-border/50 focus-visible:border-primary/40"
                      />
                    </div>
                  )}
                  <div className="space-y-1">
                    <Label htmlFor="dropdown-email" className="text-[11px] font-medium text-muted-foreground">
                      Email
                    </Label>
                    <Input
                      id="dropdown-email"
                      type="email"
                      required
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="h-9 rounded-xl bg-background/60 text-xs border-border/50 focus-visible:border-primary/40"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="dropdown-password" className="text-[11px] font-medium text-muted-foreground">
                      Password
                    </Label>
                    <Input
                      id="dropdown-password"
                      type="password"
                      required
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-9 rounded-xl bg-background/60 text-xs border-border/50 focus-visible:border-primary/40"
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full h-9 rounded-xl gradient-accent text-primary-foreground text-xs font-semibold shadow transition-all active:scale-[0.98] cursor-pointer"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        {isSignUp ? "Creating account…" : "Signing in…"}
                      </>
                    ) : (
                      isSignUp ? "Create Account" : "Sign in"
                    )}
                  </Button>
                </form>

                  <div className="pt-2 border-t border-border/50 text-center">
                    <Link
                      to="/login"
                      onClick={() => setPopoverOpen(false)}
                      className="text-xs text-primary font-medium hover:underline block"
                    >
                      Open full auth page →
                    </Link>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}
          </div>
        </div>
      </div>
    </header>
  );
}
