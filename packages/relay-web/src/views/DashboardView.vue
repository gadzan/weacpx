<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { connectEvents } from "../api/events";
import { useAuthStore } from "../stores/auth";
import { useInstancesStore } from "../stores/instances";
import { useChatStore } from "../stores/chat";
import { useTasksStore } from "../stores/tasks";
import { useNoticesStore } from "../stores/notices";
import InstanceTree from "../components/InstanceTree.vue";
import ChatPane from "../components/ChatPane.vue";
import TaskPanel from "../components/TaskPanel.vue";
import NoticeToast from "../components/NoticeToast.vue";

const instances = useInstancesStore();
const chat = useChatStore();
const tasks = useTasksStore();
const notices = useNoticesStore();
const auth = useAuthStore();
const router = useRouter();
let disconnect: (() => void) | null = null;

async function onLogout() {
  await auth.logout();
  router.push({ name: "login" });
}

function onSelect(instanceId: string, alias: string) {
  chat.select(instanceId, alias);
  void chat.loadHistory();
}

onMounted(async () => {
  await instances.loadInstances();
  disconnect = connectEvents((event) => {
    instances.applyEvent(event);
    chat.applyEvent(event);
    tasks.applyEvent(event);
    notices.applyEvent(event);
  });
});

onUnmounted(() => disconnect?.());
</script>

<template>
  <div class="flex h-screen">
    <div data-test="column" class="flex w-72 shrink-0 flex-col">
      <div class="flex items-center justify-between border-b p-2 text-xs">
        <router-link to="/settings" class="text-slate-500 hover:underline">Settings</router-link>
        <button class="text-slate-500 hover:underline" @click="onLogout">Logout</button>
      </div>
      <InstanceTree @select="onSelect" />
    </div>
    <div data-test="column" class="flex flex-1 flex-col">
      <ChatPane />
    </div>
    <div data-test="column" class="hidden w-72 shrink-0 border-l bg-white lg:block">
      <TaskPanel />
    </div>
    <NoticeToast />
  </div>
</template>
