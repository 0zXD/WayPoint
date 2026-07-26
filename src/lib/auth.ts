import { apiFetch, API_CONFIGURED } from "./api";
import { useAppStore } from "./store";
import type { LoginResponse } from "./types";

export async function login(email: string, password: string) {
  if (!API_CONFIGURED) {
    // Demo mode: accept anything, mint a fake session.
    const fake: LoginResponse = {
      token: "demo-token",
      user: {
        id: "demo",
        email,
        name: email.split("@")[0] || "Traveler",
      },
    };
    useAppStore.getState().setAuth(fake.token, fake.user);
    return fake;
  }
  const res = await apiFetch<LoginResponse>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  useAppStore.getState().setAuth(res.token, res.user);
  return res;
}

export function logout() {
  useAppStore.getState().clearAuth();
}
