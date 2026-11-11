# 本机纯脚本接口

插件提供受限的私有文件队列，脚本不调用模型，也不直接修改工作台数据文件。脚本提交请求后，工作台通过现有串行服务处理，并使用原持久化与回读流程保存。

## 配置

在本机 Cindy 中通过工作台工具 `configure_script_automation` 指定一个专用空目录 `directory`。接口为该目录生成私有连接资料；不要上传、复制到公开仓库或在日志中输出。目录权限为 0700，连接文件为 0600。当前支持 macOS 和 Linux。

该接口需要工作台及 Node 工作进程常驻，随 Cindy 启停。没有配置时不会接收请求。插件停用、退出或接口未就绪时，脚本明确失败，不启动 AI 或其他应用兜底。

公开版只开放三种操作：

- `status`：读取有效主会话及关联数量。
- `import`：提交 `docs/sources.md` 描述的通用任务清单。
- `patrol`：只巡检有效主会话已经保存的仓库关联，并生成清理预演。

接口不开放任意工具调用、会话创建、消息发送或删除操作。来源数据的获取和认证由外部适配器处理。

## 使用

```sh
node scripts/workbench-automation.cjs --queue /absolute/private-directory --operation status
node scripts/workbench-automation.cjs --queue /absolute/private-directory --operation patrol
```

外部适配器也可引用 `scripts/workbench-automation.cjs` 导出的 `submit(directory, operation, params)`。原始访问密钥仅在本机私有目录读取，不进入模型或协议输出。

客户端 stdout 只输出 `cindy-script/1` JSONL 完成帧；错误以非零退出。配置 Cindy 自动化时使用 `executionMode=script`、`persistentSession=false`、`useWorktree=false`、本地 `workingDir` 和空的宿主能力列表 `capabilities=[]`。不需要配置模型。

工作台仅在有数据变化或业务失败时发轻提示；自动化运行记录保留实际成功或失败。接口不可用等请求未到达插件的错误，以自动化失败记录为准。当前宿主的脚本通知不提供按结果条件过滤，若要求空闲不弹通知，应关闭调度本身的桌面成功通知，由插件处理变化提示。

## 边界

请求和响应使用独立的 HMAC 签名、实例标识和请求 ID，限制请求大小、期限与操作范围。领取或完成回执短暂断连时，只恢复交接确认，不重复执行业务操作。同一运行实例可重新领取未确认请求；插件重启后发现旧在途请求会返回结果未知，不能当作成功或自动重放。切换目录校验失败时保留原有连接。PR/MR 提供方查询失败时，巡检返回失败，且不记录成功检查点。

清理始终只预演。巡检不遍历整个仓库清单或任何父目录，不执行 worktree 删除、分支删除、提交、推送或开发会话启动。运行资料与工作台数据不进入公开安装包。
