import { apiFetch, API_BASE } from "./api";
import { useAppStore } from "./store";
import type { LoginResponse } from "./types";

export async function login(email: string, password: string) {
  const res = await apiFetch<LoginResponse>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  useAppStore.getState().setAuth(res.token, res.user);
  return res;
}

export async function signup(name: string, email: string, password: string) {
  const res = await apiFetch<LoginResponse>("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  });
  useAppStore.getState().setAuth(res.token, res.user);
  return res;
}

export function loginWithGoogle() {
  const googleLoginUrl = `${API_BASE}/api/v1/auth/google/login`;
  window.location.href = googleLoginUrl;
}

export function logout() {
  useAppStore.getState().clearAuth();
}
