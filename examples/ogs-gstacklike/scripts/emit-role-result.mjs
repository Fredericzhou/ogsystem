// 通用事件发射脚本。
// 设计目标：
// 1. 尽量薄，只负责把“外部输入”转成 runtime 需要的结构化 JSON。
// 2. 不在脚本里编码复杂流程分支；流程控制尽量交给 Mermaid system.mmd。
// 3. 允许通过环境变量覆盖默认事件，便于做最小验证。
const [roleId, envVarName, defaultEvent] = process.argv.slice(2);

if (!roleId || !envVarName || !defaultEvent) {
  console.error("usage: node scripts/emit-role-result.mjs <roleId> <envVarName> <defaultEvent>");
  process.exit(2);
}

// 优先读取环境变量；如果没有提供，就退回到 Mermaid 绑定时给定的默认事件。
// 这样脚本本身不需要知道完整流程，只需要负责发出当前角色的结果。
const event = process.env[envVarName] ?? defaultEvent;

// actor 只是审计辅助信息，不参与流程控制。
const actor = process.env.ROLE_ACTOR ?? process.env.USER ?? "operator";

console.log(
  JSON.stringify({
    event,
    content: `${roleId} completed with event ${event}`,
    data: {
      roleId,
      actor,
      envVar: envVarName
    }
  })
);
