import { defineConfig } from 'vitepress';

export default defineConfig({
  lang: 'en-US',
  title: 'xacpx',
  description:
    'Control acpx agent sessions remotely from WeChat, Feishu, Yuanbao, and other chat channels.',
  base: '/xacpx/',
  cleanUrls: true,
  lastUpdated: true,
  appearance: 'dark',
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Reference', link: '/reference/commands' },
      { text: 'Plugins', link: '/plugins/development' },
      { text: 'Development', link: '/development/code-wiki' }
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Channel Management', link: '/guide/channel-management' },
            { text: 'Scheduled Tasks', link: '/guide/scheduled-tasks' },
            { text: 'Native Sessions', link: '/guide/native-sessions' },
            { text: 'Group Usage', link: '/guide/group-usage' },
            { text: 'Testing', link: '/guide/testing' }
          ]
        }
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Commands', link: '/reference/commands' },
            { text: 'Configuration', link: '/reference/configuration' },
            { text: '/config Command', link: '/reference/config-command' },
            { text: 'External MCP Coordinator', link: '/reference/external-mcp' }
          ]
        }
      ],
      '/plugins/': [
        {
          text: 'Plugins',
          items: [
            { text: 'Channel Plugin Development', link: '/plugins/development' },
            { text: 'Feishu Channel', link: '/plugins/feishu' },
            { text: 'Yuanbao Channel', link: '/plugins/yuanbao' }
          ]
        }
      ],
      '/development/': [
        {
          text: 'Development',
          items: [
            { text: 'Code Wiki', link: '/development/code-wiki' },
            { text: 'Commands Module', link: '/development/commands-module' },
            { text: 'Daemon Module', link: '/development/daemon-module' },
            { text: 'Contributing', link: '/development/contributing' }
          ]
        }
      ]
    },
    search: {
      provider: 'local'
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/gadzan/xacpx' }
    ],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 xacpx contributors'
    },
    editLink: {
      pattern: 'https://github.com/gadzan/xacpx/edit/main/packages/docs/:path',
      text: 'Edit this page on GitHub'
    }
  }
});
