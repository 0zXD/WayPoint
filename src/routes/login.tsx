import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Compass, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login } from "@/lib/auth";
import { API_CONFIGURED } from "@/lib/api";

export const Route = createFileRoute("/login")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — WayPoint" },
      { name: "description", content: "Sign in to pin memories to your WayPoint map." },
      { property: "og:title", content: "Sign in — WayPoint" },
      { property: "og:description", content: "Sign in to pin memories to your map." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      toast.success("Welcome back");
      navigate({ to: "/" });
    } catch (err) {
      toast.error((err as Error).message || "Sign in failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      <div
        className="absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(60% 50% at 20% 10%, var(--primary-glow) 0%, transparent 60%), radial-gradient(50% 50% at 80% 90%, var(--primary) 0%, transparent 60%)",
        }}
      />
      <div className="glass relative w-full max-w-md rounded-3xl p-8">
        <Link to="/" className="mb-6 flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl gradient-accent text-primary-foreground">
            <Compass className="h-4 w-4" />
          </span>
          <span className="font-display text-lg font-semibold">WayPoint</span>
        </Link>

        <h1 className="font-display text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {API_CONFIGURED
            ? "Enter your WayPoint credentials."
            : "Demo mode — any email + password works."}
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@studio.co"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <Button
            type="submit"
            className="w-full gradient-accent text-primary-foreground"
            disabled={loading}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Continue
          </Button>
        </form>

        <div className="mt-6 text-center text-xs text-muted-foreground">
          <Link to="/" className="hover:text-foreground">
            ← Back to the map
          </Link>
        </div>
      </div>
    </div>
  );
}
