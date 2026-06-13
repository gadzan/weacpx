import { defineStore } from "pinia";
import { ref } from "vue";

export const useConnectionStore = defineStore("connection", () => {
  const online = ref(false);
  function setOnline(v: boolean): void {
    online.value = v;
  }
  return { online, setOnline };
});
