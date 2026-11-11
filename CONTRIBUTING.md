# 开发与提交

1. 从 `main` 创建短分支，PR 保持单一目标。
2. 同步 `ghost.json` / `package.json` 版本，清单 `releaseNotes` 描述用户可见变化。
3. 执行 `npm ci`、`npm run check`、`npm test`、`npm run pack`。UI 变更需检查亮暗主题、窄屏、长标题与原生页面；Python 变更补充语法及接口测试。
4. 三个模型文件与 `main.js` 内嵌副本须同步；检查脚本验证一致性。
5. 测试使用虚构账号、示例域名与临时仓库。不提交凭据、真实任务、个人配置、运行数据、历史包或截图证据。
6. 新增运行文件时更新 `scripts/build.mjs` 白名单，并核对最终 ZIP。截图仅使用虚构数据，勿上传个人资料。
7. 安装、市场发布、Release 属于独立明确操作；不加入自动发布密钥。

提交前缀可用 `feat` / `fix` / `refactor` / `test` / `docs` / `build` / `ci`。不默认改写历史或强推。
