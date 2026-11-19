/**
 * 入站对话归因（有界判定）：区分"他对我说的" vs 引文/转述/代理/否定/边界。
 * 纯函数，零外部依赖。
 * 用途：私信/对话只对 direct + 伴侣目标 的消息计入 connection/bond；
 * "别回复我了""他说喜欢你""我朋友让我问你"不得被当成亲密正向事件。
 * 一次判定只属于一次处理，不按 message id 缓存。
 */
/** Bounded attribution, not a general natural-language or personality classifier.
 * One immutable decision belongs to one processing attempt. Never cache by message id.
 */
export type ConversationType = 'casual' | 'affection' | 'conflict' | 'apologize' | 'gratitude'
  | 'sad' | 'happy' | 'encourage' | 'bored' | 'ask' | 'share' | 'deep_talk' | 'reject';
export type BoundaryScope = 'none' | 'addressing_style' | 'topic' | 'intimacy_expression' | 'current_reply';
export interface ConversationAssessment {
  readonly policyVersion: 'conversation-assessment-v1';
  readonly promptType: ConversationType;
  readonly directedAct: ConversationType | null;
  readonly attribution: 'direct' | 'quoted' | 'third_party' | 'uncertain';
  readonly effectPolicy: 'content_specific' | 'contact_baseline' | 'none';
  readonly responseMode: 'normal' | 'boundary' | 'attribution_uncertain';
  readonly boundaryScope: BoundaryScope;
  readonly reason: 'direct_act' | 'ordinary_contact' | 'negated_relation' | 'quoted_content'
    | 'non_companion_target' | 'ambiguous_scope' | 'current_boundary';
}

function decision(
  directedAct: ConversationType | null,
  attribution: ConversationAssessment['attribution'],
  reason: ConversationAssessment['reason'],
  boundaryScope: BoundaryScope = 'none',
): ConversationAssessment {
  return Object.freeze({
    policyVersion: 'conversation-assessment-v1',
    promptType: directedAct ?? 'casual', directedAct, attribution, reason, boundaryScope,
    effectPolicy: directedAct === null ? 'none' : directedAct === 'casual' ? 'contact_baseline' : 'content_specific',
    responseMode: boundaryScope !== 'none' ? 'boundary'
      : attribution === 'quoted' || attribution === 'uncertain' ? 'attribution_uncertain' : 'normal',
  });
}

function boundaryIn(text: string): BoundaryScope {
  if (/^\s*(?:(?:今天|现在|这次|本轮|先|请|暂时|也|就)\s*)*(?:别|不要|不用|请勿|停止)(?:再|继续|先|给我|向我|对我|立刻|马上|现在|今天|本轮|\s)*(?:回复我?|回应我?|回答我?|回我|说话)(?:了|啦|吧|好吗|好么|可以吗|一下)?\s*$|\b(?:don't|do not|stop)\s+(?:reply(?:ing)?|respond(?:ing)?|answer(?:ing)?)(?:\s+to\s+me)?(?:\s+(?:now|today|please))?\s*[.!?,;]*$/i.test(text)) return 'current_reply';
  if (/(?:别|不要|不许|请勿).{0,8}(?:叫我|称呼我)|(?:别叫|不要叫)|\bdon't\s+call\s+me/i.test(text)) return 'addressing_style';
  if (/(?:话题|这件事).{0,8}(?:到此为止|不聊|别聊|结束)|(?:别|不要|不想).{0,5}(?:聊|谈|讨论).{0,8}(?:这个|这件|该|话题)|\bstop\s+(?:this\s+)?topic/i.test(text)) return 'topic';
  if (/(?:别|不要|不想|不接受|请勿).{0,12}(?:爱我|喜欢我|示爱|表白|亲密)|\b(?:don't|do not|stop).{0,20}(?:love me|romantic|intimate)/i.test(text)) return 'intimacy_expression';
  return 'none';
}

/** Legacy non-relational vocabulary is retained; qualification is decided separately. */
function ordinaryType(text: string): ConversationType {
  if (/对不起|抱歉|sorry|不好意思/i.test(text)) return 'apologize';
  if (/谢谢|感谢|thank/i.test(text)) return 'gratitude';
  if (/伤心|难过|sad|哭|心疼|委屈/i.test(text)) return 'sad';
  if (/开心|高兴|happy|哈哈|嘿嘿/i.test(text)) return 'happy';
  if (/加油|鼓励|支持|厉害|不错|棒/.test(text)) return 'encourage';
  if (/无聊|闷/.test(text)) return 'bored';
  if (/[?？]|什么|为什么|怎么|吗$/.test(text)) return 'ask';
  if (/告诉你|分享|秘密|其实|说实话/.test(text)) return 'share';
  if (/你觉得|认为|想法|人生|意义|价值|梦想/.test(text)) return 'deep_talk';
  return 'casual';
}

export function assessConversation(message: string): ConversationAssessment {
  const text = message.normalize('NFKC').replace(/(?<=\w)’(?=\w)/g, "'").trim();
  // Preserve only a trusted phrase class, never quoted instructions themselves.
  const stripped = text.replace(/“[^”]*”|「[^」]*」|『[^』]*』|‘[^’]*’|"[^"\n]*"|(?<!\w)'[^'\n]+'|`[^`]*`/g,
    quote => /我爱你|爱我|喜欢你|喜欢我|love you|love me/i.test(quote) ? ' 亲密表达 ' : ' 引文 ');
  const reportPattern = /(?:(?:他|她|你|朋友|小明|同事|老师|有人)(?:说|告诉我|写道)|转述|台词|\b(?:he|she|they|you) said\b)/i;
  const proxyPattern = /^\s*(?:我(?:的)?(?:朋友|家人|同事|同学|老师|室友|父母)|我(?:来|在)?(?:替|代表|代为|帮(?:朋友|她|他|小明))|my\s+(?:friend|family|colleague|classmate)|on\s+behalf\s+of)/i;
  const proxy = proxyPattern.test(stripped);
  const quoted = stripped !== text || reportPattern.test(text);
  if (/[“”「」『』‘’"`]|(?:^|[\s:：])'/.test(stripped)
    || /(?:不是不|并非不|不能不|不得不|不可能不)|\b(?:not|don't|do not).{0,12}(?:dislike|not like|not love)/i.test(stripped)
    || quoted && /没有说|没说|没说过|否认说|didn't say|did not say/i.test(stripped)) {
    return decision(null, 'uncertain', 'ambiguous_scope');
  }
  // Quoted labels (e.g. 别叫我“宝宝”) do not turn the outer command into a quote.
  // Reporting scope spans following commas; only an explicit contrast opens a
  // new independent segment. Do not promote “她说，别回复我” to a player command.
  const directSegments = stripped.split(/但是|不过|然而|但|\bbut\b/i).map(segment => {
    const report = reportPattern.exec(segment);
    return proxyPattern.test(segment) ? '' : report ? segment.slice(0, report.index) : segment;
  });
  const outerClauses = directSegments.flatMap(segment => segment.split(/[，,。.!！?？;；\n]+/));
  const scopes = outerClauses.map(boundaryIn);
  const outerBoundary = scopes.includes('current_reply') ? 'current_reply' : scopes.find(scope => scope !== 'none');
  if (outerBoundary) {
    const attack = outerClauses.some(clause => /你(?:真|很|太|简直)?(?:恶心|烦死了|真烦)|我(?:真的|很|最)?(?:讨厌|恨)你(?:[啊呀呢!！。.,，\s]|$)|\b(?:i hate you|you are disgusting)\b/i.test(clause));
    return decision(attack ? 'conflict' : null, 'direct', 'current_boundary', outerBoundary);
  }
  // Only an independent explicit clause can escape a reported/quoted statement.
  const contrast = stripped.split(/但是|不过|然而|但|\bbut\b/i);
  const direct = quoted || proxy ? (contrast.length > 1 && !reportPattern.test(contrast.at(-1)!) && !proxyPattern.test(contrast.at(-1)!) ? contrast.at(-1)!.trim() : '') : stripped;
  if ((quoted || proxy) && !direct) return proxy
    ? decision(null, 'third_party', 'non_companion_target') : decision(null, 'quoted', 'quoted_content');

  const boundary = boundaryIn(direct);
  const attacks = /你(?:真|很|太|简直)?(?:恶心|烦死了|真烦)|我(?:真的|很|最)?(?:讨厌|恨)你(?:[啊呀呢!！。.,，\s]|$)|\b(?:i hate you|you are disgusting)\b/i.test(direct);
  if (boundary !== 'none') return decision(attacks ? 'conflict' : null, 'direct', 'current_boundary', boundary);
  if (/呵呵|我可真(?:喜欢|爱)|\byeah[ ,]*right\b|\bas if\b|\/s\b/i.test(direct)) return decision(null, 'uncertain', 'ambiguous_scope');
  if (/(?:不|没|未|从不|并不).{0,4}(?:喜欢|爱|想你|想念|感谢|谢谢|讨厌|恨|支持|开心|高兴|伤心|难过|生气)|\b(?:don't|do not|never|not).{0,12}(?:love|like|miss|hate|thank)/i.test(direct)) {
    return decision(null, 'direct', 'negated_relation');
  }
  if (attacks) return decision('conflict', 'direct', 'direct_act');
  if (/^(?:滚|闭嘴|烦死了)[!！。\s]*$/.test(direct)) return decision('reject', 'direct', 'direct_act');
  if (/拒绝|不接受/.test(direct)) return /^\s*我/.test(direct)
    ? decision(null, 'direct', 'negated_relation') : decision(null, 'uncertain', 'ambiguous_scope');
  if (/(?:我(?:真的|很|也|一直|特别|最)?(?:喜欢|爱)你|想你)(?:了|啊|呀|呢|哦)?(?:[!！。.,，?？\s]|$)|\bi (?:love|like|miss) you\b/i.test(direct)) {
    return decision('affection', 'direct', 'direct_act');
  }
  // A relational keyword without a proven companion target is not a relational act.
  if (/喜欢|爱|讨厌|恨|生气|\b(?:love|like|hate)\b/i.test(direct)) {
    return decision(null, /你(?:讲|说|写|做)的/.test(direct) ? 'direct' : 'third_party', 'non_companion_target');
  }
  const type = ordinaryType(direct);
  if (/^(?:他|她|他们|她们|小明|朋友|同事|老师)|\b(?:he|she|they)\b/i.test(direct) && type !== 'casual') {
    return decision(null, 'third_party', 'non_companion_target');
  }
  if (type === 'gratitude' && !/谢谢你|感谢你|谢谢您|感谢您|^(?:谢谢|感谢)[!！。\s]*$|\bthank(?:s| you)\b/i.test(direct)) {
    return decision(null, 'third_party', 'non_companion_target');
  }
  if (/不要|别再|不许|请勿|\bdon't\b/i.test(direct)) return decision(null, 'uncertain', 'ambiguous_scope');
  return decision(type, 'direct', type === 'casual' ? 'ordinary_contact' : 'direct_act');
}
