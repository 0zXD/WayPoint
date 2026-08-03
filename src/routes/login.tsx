import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Compass, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, signup, loginWithGoogle } from "@/lib/auth";
import { useAppStore } from "@/lib/store";
import { API_CONFIGURED } from "@/lib/api";

export const Route = createFileRoute("/login")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in / Sign up — WayPoint" },
      { name: "description", content: "Sign in or sign up to pin memories to your WayPoint map." },
      { property: "og:title", content: "Sign in / Sign up — WayPoint" },
      { property: "og:description", content: "Sign in or sign up to pin memories to your map." },
    ],
  }),
  component: LoginPage,
});

function GoogleIcon() {
  return (
    <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  );
}

function LoginPage() {
  const navigate = useNavigate();
  const [isSignUp, setIsSignUp] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // Handle Google OAuth redirect callback search params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const userId = params.get("userId");
    const userEmail = params.get("email");
    const userName = params.get("name");

    if (token && userId && userEmail) {
      useAppStore.getState().setAuth(token, {
        id: userId,
        email: userEmail,
        name: userName || userEmail.split("@")[0],
      });
      toast.success("Successfully signed in with Google");
      navigate({ to: "/" });
    }
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isSignUp) {
        await signup(name, email, password);
        toast.success("Account created successfully");
      } else {
        await login(email, password);
        toast.success("Welcome back");
      }
      navigate({ to: "/" });
    } catch (err) {
      toast.error((err as Error).message || (isSignUp ? "Sign up failed" : "Sign in failed"));
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
      <div className="glass relative w-full max-w-md rounded-3xl p-8 shadow-2xl">
        <Link to="/" className="mb-6 flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl gradient-accent text-primary-foreground">
            <Compass className="h-4 w-4" />
          </span>
          <span className="font-display text-lg font-semibold">WayPoint</span>
        </Link>

        <h1 className="font-display text-2xl font-semibold tracking-tight">
          {isSignUp ? "Create an account" : "Sign in"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isSignUp
            ? "Sign up to save & explore spatial memories."
            : API_CONFIGURED
            ? "Enter your WayPoint credentials."
            : "Enter your credentials or test demo mode."}
        </p>

        {/* Google OAuth Button */}
        <div className="mt-6">
          <Button
            type="button"
            variant="outline"
            className="w-full border-border/60 bg-background/50 hover:bg-accent/40"
            onClick={loginWithGoogle}
          >
            <GoogleIcon />
            {isSignUp ? "Sign up with Google" : "Sign in with Google"}
          </Button>
        </div>

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border/50" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">Or continue with email</span>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {isSignUp && (
            <div className="space-y-1.5">
              <Label htmlFor="name">Full Name</Label>
              <Input
                id="name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Alex Morgan"
              />
            </div>
          )}

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
            className="w-full gradient-accent text-primary-foreground transition-all duration-200 hover:opacity-95"
            disabled={loading}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isSignUp ? "Create Account" : "Continue"}
          </Button>
        </form>

        <div className="mt-6 text-center text-sm text-muted-foreground">
          {isSignUp ? (
            <p>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => setIsSignUp(false)}
                className="font-medium text-primary hover:underline"
              >
                Sign in
              </button>
            </p>
          ) : (
            <p>
              Don't have an account?{" "}
              <button
                type="button"
                onClick={() => setIsSignUp(true)}
                className="font-medium text-primary hover:underline"
              >
                Sign up
              </button>
            </p>
          )}
        </div>

        <div className="mt-6 text-center text-xs text-muted-foreground">
          <Link to="/" className="hover:text-foreground">
            ← Back to the map
          </Link>
        </div>
      </div>
    </div>
  );
}
