<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const router = useRouter();
const username = ref("");
const password = ref("");

async function submit() {
  if (await auth.login(username.value, password.value)) router.replace("/");
}
</script>

<template>
  <div class="flex h-screen items-center justify-center bg-slate-100">
    <form class="w-80 space-y-3 rounded-lg bg-white p-6 shadow" @submit.prevent="submit">
      <h1 class="text-lg font-semibold">xacpx relay</h1>
      <input v-model="username" class="w-full rounded border px-3 py-2" placeholder="username" />
      <input v-model="password" type="password" class="w-full rounded border px-3 py-2" placeholder="password" />
      <p v-if="auth.error" class="text-sm text-red-600">{{ auth.error }}</p>
      <button class="w-full rounded bg-slate-800 px-3 py-2 text-white" type="submit">Sign in</button>
    </form>
  </div>
</template>
