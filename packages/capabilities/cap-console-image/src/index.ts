/**
 * 看她收的图。
 *
 * 为什么需要它：主人往控制台发图时，如果当前模型不接收图像，正文里只会留一句
 * "图没进来"。她就只能顺着"附图"猜内容，或者装作看见了——两种都不诚实。
 * 这把工具把那张图的字节交回去，下一轮请求就真的带上了它。
 *
 * 为什么是注入而不是本包自己去翻事件库：事件库是宿主的（`WorldHost.store`），
 * 本包不反向依赖任何底座。组装方把「列出可看的图」和「取某张图」两个能力传进来，
 * 没有就是这把工具不可用——**而不是假装能看**。
 *
 * 原本这是宿主内置 console 上的一把工具（2026-11-19 的 69 行改动），
 * 2026-11-20 挪成独立能力包：那是我们的功能，不该住在别人的世界里。
 */
import type {
  CapabilityPanelDecl,
  PanelMethodDecl,
  ToolRegistration,
  XiaoyuCapability,
} from '../../../kernel/persona-core/src/capability.ts'

/** 一张还留在控制台上的图。只报事实，不下结论说内容是什么。 */
export interface ConsoleImage {
  /** 宿主分配的句柄（`log:...` / `mem:...`）。 */
  handle: string
  /** 谁发的。 */
  from: string
  /** 什么时候（ISO 8601）。 */
  at: string
  /** 图的一句话替代文本（发送方给不出时为空）。 */
  fallbackText: string
  mime: string
}

export interface ConsoleImageOptions {
  /**
   * 控制台上还留着哪些图（新→旧）。读不到返回空数组，不要抛。
   * 组装方注入：本包不知道事件库长什么样。
   */
  listImages: () => ConsoleImage[]
  /**
   * 按句柄取图的字节。取不到返回 null。
   */
  readImage: (handle: string) => { bytes: Uint8Array; mime: string } | null
  /**
   * 当前模型收不收图。`accepts(mime)` 为 false 时工具要**明说看了也收不到**，
   * 而不是白白把字节塞进回执。
   */
  acceptsImage: () => { model: string; accepts: boolean }
}

export interface ConsoleImageConfig {
  /** 清单里最多摆几张。 */
  inventoryMax: number
}

const CONSOLE_IMAGE_DEFAULTS: ConsoleImageConfig = { inventoryMax: 12 }

export function createConsoleImageCapability(
  opts: ConsoleImageOptions,
): XiaoyuCapability<ConsoleImageConfig> {
  const max = CONSOLE_IMAGE_DEFAULTS.inventoryMax

  const inventory = (): string => {
    const images = (() => {
      try {
        return opts.listImages()
      } catch {
        return []
      }
    })()
    if (!images.length) return '[see_image] 控制台上还没有图。'
    const lines = images.slice(0, max).map(
      (img) => `- ${img.handle} · ${img.at.replace('T', ' ').slice(0, 19)} · ${img.from} · ${img.fallbackText}`,
    )
    return `[see_image] 控制台上还留着这些图（要哪张就把句柄传回来）：\n${lines.join('\n')}`
  }

  const tools: ToolRegistration[] = [
    {
      name: 'console_see_image',
      summary: '看控制台上发来的图片（回执带上图片内容，下一轮请求就能看到）',
      description:
        'Look at an image that was sent on the console. Returns the image bytes so the next request carries them. '
        + 'Call it with no argument to see what images are available. '
        + 'Only works when the running model accepts images — otherwise it says so instead of pretending.',
      parameters: {
        type: 'object',
        properties: {
          handle: {
            type: 'string',
            description: 'Blob handle shown in the message (log:...). Omit to list recent console images.',
          },
        },
      },
      execute(args: { handle?: string }) {
        const wanted = typeof args?.handle === 'string' ? args.handle.trim() : ''
        // 清单与"能不能看"无关：看不了也照样告诉她这张图在、是谁发的。
        if (!wanted) return inventory()

        /**
         * 先确认"我到底连上没有"，再看模型能力。
         *
         * 2026-11-20 接线时发现的顺序错：原来先问 acceptsImage，宿主没 start 时
         * 它会返回"未知模型、不收图"，于是回执是「当前模型 未知模型 不接收图像」——
         * 而真相是**模块根本没起来**。报错要指向真原因，否则查起来会往模型配置上找。
         */
        const found = (() => {
          try {
            return opts.readImage(
              wanted.startsWith('log:') || wanted.startsWith('mem:') ? wanted : `log:${wanted}`,
            )
          } catch {
            return null
          }
        })()
        // 取不到分两种：真没这张图，还是模块没接上。前者由下面统一回执；
        // 后者用一个明确的哨兵区分不了，所以就按"取不到"报，并在清单里说明没有图。
        if (!found) {
          return `[see_image] 取不到这张图：${wanted}。不带参数调一次可以看还有哪些。`
        }
        if (!found.mime.startsWith('image/')) {
          return `[see_image] 取不到这张图：${wanted}。不带参数调一次可以看还有哪些。`
        }

        const facts = (() => {
          try {
            return opts.acceptsImage()
          } catch {
            return { model: '未知模型', accepts: false }
          }
        })()
        if (!facts.accepts) {
          return `[see_image] 当前模型 ${facts.model} 不接收图像，我看了也收不到。`
            + '要么让主人换一个支持图像的模型，要么让主人在消息里说明图里是什么。'
        }

        const handle = wanted.startsWith('log:') || wanted.startsWith('mem:') ? wanted : `log:${wanted}`
        return {
          text: `[see_image] ${handle}（${found.mime}，${Math.round(found.bytes.length / 1024)} KB）`,
          blobs: [{ bytes: found.bytes, mime: found.mime, fallbackText: `image ${handle}` }],
        }
      },
    },
  ]

  const panelMethods: Record<string, PanelMethodDecl<any, any>> = {
    list: {
      name: 'list', verb: 'GET', writable: false,
      summary: '控制台上还留着哪些图（句柄、时刻、发图人）',
      invoke: () => ({
        ok: true,
        accepts: opts.acceptsImage(),
        images: (() => {
          try {
            return opts.listImages()
          } catch {
            return []
          }
        })(),
      }),
    },
    setInventoryMax: {
      name: 'setInventoryMax', verb: 'POST', writable: true,
      summary: '改清单里最多摆几张',
      invoke: (params: { inventoryMax?: number } = {}) => {
        const n = Number(params?.inventoryMax)
        if (!Number.isFinite(n) || n < 1 || n > 50) throw new Error('inventoryMax 只能是 1–50')
        return { ok: true, inventoryMax: Math.round(n) }
      },
    },
  }

  const panels: CapabilityPanelDecl[] = [
    {
      id: 'console-image',
      title: '她收的图',
      description: '控制台上发来的图片：谁发的、什么时候、当前模型能不能看。',
      methods: panelMethods,
    },
  ]

  return {
    id: 'console-image',
    title: '控制台图片',
    kind: 'internal',
    configSchema: {
      type: 'object',
      title: '控制台图片配置',
      properties: {
        inventoryMax: { type: 'integer', title: '清单最多几张', default: CONSOLE_IMAGE_DEFAULTS.inventoryMax, minimum: 1, maximum: 50 },
      },
    },
    defaultConfig: { ...CONSOLE_IMAGE_DEFAULTS },
    tools: () => tools,
    panels: () => panels,
  }
}
