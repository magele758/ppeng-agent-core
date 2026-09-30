export const modelFallback = {
  title: '模型备选',
  desc: '主模型上游持续故障（5xx、429、超时、连接错误、服务过载，且内置重试已耗尽）时，本轮按下方顺序切换到备选模型继续；鉴权 / 参数错误、用户中止、复读或思考空转收尾、内容审核拒绝一律不回退。只改变当轮所用模型，不会改写会话或 Bot 绑定的模型，下一轮仍先用主模型。链为空即关闭。',
  chainTitle: '备选顺序（自上而下依次尝试）',
  empty: '未配置备选模型，当前不会回退',
  addLabel: '添加备选模型',
  addPlaceholder: '选择已配置的模型…',
  add: '添加',
  noOptions: '没有可添加的模型，请先在上方「模型服务商」中配置',
  moveUp: '上移',
  moveDown: '下移',
  remove: '移除',
  save: '保存备选链',
  effectiveCount: '生效 {count} 个',
  issueNotConfigured: '已不在可选模型中，运行时会跳过',
  issueMissingCredentials: '缺少 API Key 或 Base URL，运行时会跳过',
  heuristicExcluded: '本地启发式模型不会出现在此列表，也不能作为备选',
  dirty: '有未保存的修改'
};
