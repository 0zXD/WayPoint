import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Compass, Loader2, LogIn, LogOut, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
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
import { API_CONFIGURED } from "@/lib/api";
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
  const isDrawerOpen = !!openClusterKey;
  const initials = user?.name?.slice(0, 2).toUpperCase() ?? "?";

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
    demo: { color: "bg-primary animate-pulse", label: "Demo" },
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

  const handleQuickDemo = async () => {
    setLoading(true);
    try {
      const res = await login("explorer@waypoint.app", "demo123");
      toast.success(`Welcome back, ${res.user.name}!`);
      setPopoverOpen(false);
    } catch (err) {
      toast.error("Demo login failed");
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

        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground sm:left-3 sm:h-4 sm:w-4" />
          <Input
            placeholder="Search places, memories…"
            className="h-8 rounded-xl border-transparent bg-background/50 pl-8 text-xs sm:h-9 sm:pl-9 sm:text-sm focus-visible:border-primary/40"
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>

        <div
          title={`Real-Time Stream: ${status.label}`}
          className="hidden items-center justify-center sm:flex px-1"
        >
          <span className={`h-2 w-2 rounded-full ${status.color}`} />
        </div>

        <ThemeToggle />

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
                    className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                      !isSignUp ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsSignUp(true)}
                    className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                      isSignUp ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"
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
    </header>
  );
}
