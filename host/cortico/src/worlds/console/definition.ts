import { describeTools, type WorldDefinition } from '../../world.ts';
import { CONSOLE_DEFAULTS, type ConsoleConfigSection } from './config.ts';
import { CONSOLE_TOOL_DECLS, ConsoleWorld } from './world.ts';

export const CONSOLE: WorldDefinition<ConsoleConfigSection> = {
  id: 'console',
  label: '控制台对话',
  defaults: () => ({ ...CONSOLE_DEFAULTS }),
  create: (ctx) => new ConsoleWorld({
    timezone: ctx.timezone,
    botName: ctx.botName,
    cfg: ctx.cfg,
  }),
  describe: {
    tools: describeTools(CONSOLE_TOOL_DECLS, {
      console_send: {
        zh: '在 WebUI 控制台页上发一条消息,所有连着的人都能看到。',
        en: 'Posts a message on the WebUI Console page for everyone connected.',
      },
      console_see_image: {
        zh: '看控制台上发来的图片（回执带上图片内容，下一轮请求就能看到）。',
        en: 'Looks at an image sent on the console; the next request carries its bytes.',
      },
    }),
    events: [
      {
        type: 'console.message',
        description: { zh: '有人在控制台页上发了消息,可带图片。', en: 'Someone posted a message, possibly with images, on the Console page.' },
        trigger: 'flush',
      },
      {
        type: 'console.invite',
        description: { zh: '有人在控制台页按下了开始对话的按钮。', en: 'Someone pressed the start button on the Console page.' },
        trigger: 'flush',
      },
      {
        type: 'console.self',
        description: { zh: 'bot 自己在控制台发出的消息,只记录,不唤醒。', en: "The bot's own Console message; recorded without waking the bot." },
      },
    ],
  },
};
