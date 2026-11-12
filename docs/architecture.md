# 架构

- `ghost.json`：身份、版本、工具、Node 与页面声明。
- `main.js`：沙箱服务、串行修改、双槽持久化与幂等回执。
- `model.js` / `review-model.js` / `source-model.js`：迁移、审阅和通用来源纯模型，也内嵌于 `main.js`。
- `ui.html/css/js`、`board-drag.js`：工作台界面与交互。
- `node/worker.cjs`：JSON-RPC stdio 仓库查询入口。
- `node/git.cjs` / `repo-discovery.cjs`：Git/gh/glab 查询、编辑器入口、用户所选目录的有限检测。
- `automation-main.js` / `automation-operations.js`：受限脚本请求与原串行写队列共用服务。
- `node/automation-queue.cjs`：实例隔离、签名校验、权限检查及未知结果保护。
- `scripts/`：检查、白名单构建、ZIP 打包和虚构数据预览。
- `tests/`：虚构宿主和数据、临时仓库测试。
- `docs/screenshots/`：当前界面在虚构数据下的真实渲染截图。
- `.tests/contracts/`：固定版本官方 Manifest 结构校验器。

外部工具取数后，通过 `source/import` 或 Agent 工具 `import_source_items` 交接统一数据。核心不连接任何工单服务，也不包含来源专用运行依赖。

运行数据通过 Cindy 插件数据目录保存。迁移前备份、写后回读，保存 `state-a.json` / `state-b.json` 双槽。每条仓库关联各自记录 HEAD 与验证 HEAD，观测提交变更后需要重新确认验证。

宿主契约参考随包文档；官方插件仓规范固定为 `bca1aa80988e31c702c6807145eab534aedc1ca8`。该提交不是本机 Cindy 宿主构建的源码证明。自动测试与预览截图不代表最低宿主版本、真实业务或原生手势已全部验收。

任务地址覆盖使用独立的 `manualUrl` 字段：缺省表示来源默认，空字符串明确隐藏，非空为校验后的 HTTPS 地址。`useSourceUrl=true` 清除覆盖字段；来源导入仍按原身份和原 URL 去重，不覆盖手动设置。
