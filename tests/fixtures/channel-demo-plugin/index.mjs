const demoCliProvider = {
  type: "demo-fixture",
  displayName: "Demo Fixture",
  supportsLogin: false,
  parseAddArgs(args) {
    if (args.length !== 0) return { ok: false, message: "demo-fixture does not accept flags" };
    return { ok: true, input: {} };
  },
  buildDefaultConfig() {
    return { id: "demo-fixture", type: "demo-fixture", enabled: true };
  },
  validateConfig() {
    return [];
  },
  renderSummary(config) {
    return [`type: ${config.type}`, `enabled: ${config.enabled}`];
  },
  async promptForMissingFields(input) {
    return input;
  },
};

export default {
  apiVersion: 1,
  name: "demo-fixture-plugin",
  channels: [
    {
      type: "demo-fixture",
      factory: () => ({ id: "demo-fixture", start: async () => {} }),
      cliProvider: demoCliProvider,
    },
  ],
};
