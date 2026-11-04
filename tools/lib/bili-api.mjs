/**
 * 转发壳：真身已收编进 packages/cap-bilibili/src/platform/api.mjs（独立化 A2 第三批，2026-11-04）。
 * 本壳保证 tools/ 的 CLI 薄壳与 tests/ 的既有引用零破坏。
 * 新代码（包内）一律 import 真身。
 */
export * from '../../packages/cap-bilibili/src/platform/api.mjs'
