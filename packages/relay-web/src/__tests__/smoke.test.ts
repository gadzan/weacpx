import { mount } from "@vue/test-utils";
import { expect, test } from "vitest";
import LoginView from "../views/LoginView.vue";

test("toolchain mounts a component", () => {
  const wrapper = mount(LoginView);
  expect(wrapper.text()).toContain("login");
});
