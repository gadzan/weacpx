import { defineStore } from "pinia";
import { ref } from "vue";
import { ApiError, api } from "../api/client";

export interface Account {
  username: string;
  role: "admin" | "member";
}

export const useAuthStore = defineStore("auth", () => {
  const account = ref<Account | null>(null);
  const error = ref("");

  async function login(username: string, password: string): Promise<boolean> {
    error.value = "";
    try {
      account.value = await api.post<Account>("/api/login", { username, password });
      return true;
    } catch (e) {
      error.value = e instanceof ApiError ? e.code : "request-failed";
      account.value = null;
      return false;
    }
  }

  async function fetchMe(): Promise<boolean> {
    try {
      account.value = await api.get<Account>("/api/me");
      return true;
    } catch {
      account.value = null;
      return false;
    }
  }

  async function logout(): Promise<void> {
    await api.post("/api/logout").catch(() => {});
    account.value = null;
  }

  return { account, error, login, fetchMe, logout };
});
