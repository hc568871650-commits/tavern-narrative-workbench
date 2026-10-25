# 发布到 GitHub：让酒馆粘贴链接安装

## 1. 上传哪个目录

使用交付的 `tavern-narrative-workbench` 文件夹，或解压同名发布 ZIP。**上传文件夹里面的内容，而不是把整个文件夹套在仓库根目录下。**

仓库首页应直接呈现：

```text
manifest.json
index.js
core.js
host.js
actions.js
dock.js
style.css
dock.css
examples/
tests/
scripts/
package.json
compatibility.json
README.md
RELEASING.md
INSTALL-VERIFICATION.md
.gitignore
```

无需上传整个开发工作区。不要上传 `work/`、`node_modules/`、酒馆 `data/`、聊天备份、浏览器截图、配置密钥或数据库上游源码。当前交付包已经独立整理好。

## 2. 建仓库并上传

本项目公开仓库：https://github.com/hc568871650-commits/tavern-narrative-workbench 。后续更新提交到该仓库的 `main` 分支。普通安装链接不含私有仓库登录凭据；要让他人直接安装，公开仓库最方便。

GitHub 网页操作：

1. 新建仓库；若选择了自动生成 README，上传时用本包 README 替换。
2. 选择 **Add file → Upload files**，上传解压目录中的所有文件与子目录，提交到默认分支。
3. 仓库首页确认能直接打开 `manifest.json`，并且 `index.js`、`style.css`、`dock.css` 和 `examples/` 都存在。
4. 将 README 中 `https://github.com/hc568871650-commits/tavern-narrative-workbench` 替换成真实仓库首页地址。
5. 按实际作者信息修改 `manifest.json` 的 `author`（当前为项目中性名称），可补充 `homePage` 为真实仓库地址。若要授予开源使用许可，由发布者选择合适许可证并添加 `LICENSE`；不要给上游依赖代签许可。

ZIP 仅方便下载和上传前整理。**只把 ZIP 放进 GitHub Release、而不把源码文件提交到仓库根目录，不能通过酒馆 Git 链接安装。** 不需要 GitHub Pages、npm 发布或构建服务。

## 3. 发给使用者的安装说明

下方使用本项目实际仓库链接，可复制给使用者：

> 这是 SillyTavern 前端扩展，需先有能安装第三方扩展的酒馆。打开「扩展 → 安装扩展」，先装数据库 `https://github.com/AlbusKen/shujuku`，刷新后再装工作台 `https://github.com/hc568871650-commits/tavern-narrative-workbench`。再次刷新，进入角色卡聊天，在工作台配置表格映射即可使用。物品动作只加入输入草稿，不自动发送。手机使用同一酒馆实例即可；本包不是 APK。

数据库和工作台是两个仓库，需要分别安装。工作台清单中的依赖声明只用于检查，不能自动下载数据库。

## 4. 发布后自检

1. 在测试酒馆粘贴真实 GitHub 仓库链接完成安装，确认扩展列表显示 0.3.1。
2. 刷新后确认工作台与数据库都启用，依次打开入口、卡片适配和数据库编辑器。
3. 在空白测试聊天载入「操作栏样例」，应用并初始化样例表；查看背包，尝试把动作加入已有草稿，确认原文保留且未自动发送。
4. 手机竖屏、横屏各检查一次，再打开软键盘检查输入区和弹层。不把桌面模拟测试视为手机验收。
5. 如果安装报缺少 manifest，先检查是否把文件放到了多余子目录；如果数据库未就绪，检查依赖是否启用并刷新。

本地镜像安装验证不能证明 GitHub 仓库可访问。本版本真实公开链接安装已通过，详见 INSTALL-VERIFICATION.md；首次样例初始化与手机真机等未完成项目仍需单独验收。

## 5. 后续更新

修改后运行 `npm test` 与 `npm run check-package`，同步 `manifest.json`、`package.json` 和 `compatibility.json` 的版本号，再提交到同一默认分支。使用者在酒馆扩展管理里更新并刷新。

可以为正式版本创建 `v0.3.1` 等标签和 GitHub Release，方便标记与下载；链接安装仍用仓库首页。不要随意更改仓库名或默认分支，以免影响已有安装。

如需回退代码，可在仓库默认分支提交一次撤销更新，让已安装用户更新后获取修复版本。数据备份和恢复使用酒馆/数据库原生功能，不用代码回退冒充存档回退。
