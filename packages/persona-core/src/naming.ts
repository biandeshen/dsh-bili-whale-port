/**
 * 主人怎么被她称呼，只有一个来源：配置里的 `owner.displayName`（回落 `owner.name`）。
 * 之前"鱼片"这个称呼散在情绪独白、生活活动、禁称表、日记抬头、私信草稿五处，
 * 改名要动代码；现在改名只改配置，措辞跟着走。
 */
let owner = '鱼片'

/** 名字来自用户可编辑的配置，所以这里做边界：去空白、限 24 字，空值保持现名。返回生效后的名字。 */
export function setOwnerName(name: unknown): string {
  const v = String(name ?? '').trim().slice(0, 24)
  if (v) owner = v
  return owner
}

export function ownerName(): string {
  return owner
}
