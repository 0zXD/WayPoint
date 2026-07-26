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
import { login, logout } from "@/lib/auth";
import { API_CONFIGURED } from "@/lib/api";
import type { WSStatus } from "@/lib/ws";

export function Header({
  wsStatus,
  onSearch,
}: {
  wsStatus: WSStatus;
  onSearch: (q: string) => void;
}) {
  const user = useAppStore((s) => s.user);
  const initials = user?.name?.slice(0, 2).toUpperCase() ?? "?";

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const statusMap: Record<WSStatus, { color: string; label: string }> = {
    idle: { color: "bg-muted-foreground", label: "Idle" },
    connecting: { color: "bg-yellow-500 animate-pulse", label: "Connecting" },
    open: { color: "bg-success animate-pulse", label: "Live" },
    closed: { color: "bg-destructive", label: "Offline" },
    demo: { color: "bg-primary animate-pulse", label: "Demo" },
  };
  const status = statusMap[wsStatus];

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    try {
      const res = await login(email, password);
      toast.success(`Welcome back, ${res.user.name}!`);
      setPopoverOpen(false);
      setEmail("");
      setPassword("");
    } catch (err) {
      toast.error((err as Error).message || "Sign in failed");
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
    <header className="pointer-events-none fixed inset-x-0 top-0 z-[500] flex justify-center px-3 pt-3 sm:px-6 sm:pt-5">
      <div className="glass pointer-events-auto flex w-full max-w-5xl items-center gap-2 rounded-2xl px-3 py-2 sm:gap-3 sm:px-4">
        <Link to="/" className="flex items-center gap-2 pr-2">
          <span className="grid h-8 w-8 place-items-center rounded-xl gradient-accent text-primary-foreground shadow">
            <Compass className="h-4 w-4" />
          </span>
          <span className="hidden font-display text-lg font-semibold tracking-tight sm:block">
            WayPoint
          </span>
        </Link>

        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search places, people, memories…"
            className="h-9 rounded-xl border-transparent bg-background/50 pl-9 focus-visible:border-primary/40"
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>

        <div className="hidden items-center gap-1.5 rounded-full border border-border/60 bg-background/40 px-2.5 py-1 text-xs text-muted-foreground sm:flex">
          <span className={`h-1.5 w-1.5 rounded-full ${status.color}`} />
          {status.label}
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
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="grid h-6 w-6 place-items-center rounded-lg gradient-accent text-primary-foreground">
                      <LogIn className="h-3 w-3" />
                    </span>
                    <h4 className="font-display text-sm font-semibold tracking-tight">Sign in to WayPoint</h4>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed pt-1">
                    {API_CONFIGURED
                      ? "Enter your credentials to access your places & memories."
                      : "Demo mode — sign in with any email & password."}
                  </p>
                </div>

                <form onSubmit={handleSignIn} className="space-y-3">
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
                        Signing in…
                      </>
                    ) : (
                      "Sign in"
                    )}
                  </Button>

                  {!API_CONFIGURED && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleQuickDemo}
                      disabled={loading}
                      className="w-full h-8 text-[11px] text-primary hover:bg-primary/10 rounded-xl transition-colors cursor-pointer"
                    >
                      <Sparkles className="mr-1.5 h-3 w-3" />
                      Quick Demo Sign In
                    </Button>
                  )}
                </form>
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </header>
  );
}
