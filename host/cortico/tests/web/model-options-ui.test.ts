import { afterEach, describe, expect, it } from 'vitest';
import { button, change, FIXTURE_OPEN_KIND, flush, mountSettings } from './provider-settings-fixture.ts';
let cleanup: () => void = () => {};
afterEach(() => cleanup());

const declared = ['fixture-alpha', 'fixture-beta', 'fixture-gamma'];

describe('端点声明的模型候选', () => {
  it('声明了就列出来，点其中一个名字就换成它', async () => {
    const view = await mountSettings(FIXTURE_OPEN_KIND, {}, {
      model: 'fixture-alpha',
      thinking: false,
      modelOptions: declared,
    } as never);
    cleanup = view.cleanup;
    expect(view.root.textContent).toContain('端点声明了 3 个候选');
    button(view.root, 'fixture-beta').click();
    await flush();
    expect(view.read().providers.primary.spec!.model).toBe('fixture-beta');
  });

  it('候选只是建议：模型格仍可手写清单外的名字', async () => {
    const view = await mountSettings(FIXTURE_OPEN_KIND, {}, {
      model: 'fixture-alpha',
      thinking: false,
      modelOptions: declared,
    } as never);
    cleanup = view.cleanup;
    change(view.root.querySelector('[aria-label="模型"]'), 'fixture-unlisted');
    await flush();
    expect(view.read().providers.primary.spec!.model).toBe('fixture-unlisted');
  });

  it('没有声明候选时不出现候选行', async () => {
    const view = await mountSettings(FIXTURE_OPEN_KIND);
    cleanup = view.cleanup;
    expect(view.root.textContent).not.toContain('个候选');
  });
});
