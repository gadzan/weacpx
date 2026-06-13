import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";

const routes: RouteRecordRaw[] = [
  { path: "/login", name: "login", component: () => import("../views/LoginView.vue") },
  { path: "/", name: "dashboard", component: () => import("../views/DashboardView.vue") },
];

export const router = createRouter({ history: createWebHistory(), routes });
