# 0.4.0 发布说明

本目录为叙事工作台 0.4.0 预览版的发布候选。开发交付时尚未推送本版；本地 Git 安装通过，不代表公开仓库已提供 0.4.0。发布者须在完成发布后补充实际提交、CI、安装及下载校验记录。

## 发布目标

- 更新现有仓库：<https://github.com/hc568871650-commits/tavern-narrative-workbench>
- 默认分支：`main`。建议标签：`v0.4.0`。Release 标题：`叙事工作台 v0.4.0 预览版`。
- Release 勾选 **This is a pre-release**，不宣传为正式稳定版。
- 无需新建仓库、GitHub Pages、npm 发布或前端构建。
- 已有数据库依赖：<https://github.com/AlbusKen/shujuku>，单独安装，不随本包分发。

## 源码放置

将发布 ZIP 解压后的**内容**放进仓库根目录，首页直接看到 `manifest.json`、`index.js` 和 `style.css`。不要套一层版本文件夹，也不要只把 ZIP 上传到 Release。

完整保留 JavaScript/CSS 模块、`examples/`、`tests/`、`scripts/`、文档、`.github/workflows/check.yml`、`.gitattributes`、`.gitignore`。隐藏文件也要提交。不要上传本地测试服务器、`work/`、`node_modules/`、聊天数据、密钥或测试头像。

本包已使用真实仓库地址。维持现有署名和许可证状态，不把上游数据库代码合并进来。

## 发布步骤

1. 在干净检出中读取远程最新 `main`。确认没有其他人尚未合并的改动；将本包内容整合进根目录，不覆盖无关成果。
2. 检查 `manifest.json`、`package.json` 与 `compatibility.json` 的版本均为 `0.4.0`。在仓库根目录运行：
   ```sh
   npm test
   npm run check-package
   git diff --check
   ```
   当前预期为 118 项测试通过。没有 npm 运行时依赖，不需要先构建。
3. 检查变更，提交到 `main` 并等待 GitHub Actions 的 `Package checks` 完成。发布记录写入最终 commit SHA 与对应 CI 链接。
4. 用隔离酒馆依次从两个真实 GitHub 链接安装；确认显示 0.4.0，且新增图片模块/样式能加载。测试时避免同名全局扩展遮住用户目录的新安装。
5. 在另一个测试副本中，从原有 0.3.1 使用酒馆「管理扩展 → 更新」升级到 0.4.0，确认原聊天、适配配置仍可读取。**无变化更新测试不能代替旧版本升级测试。**
6. 按 [验收记录](INSTALL-VERIFICATION.md) 补验尚未完成的界面项目，并记录结果。无法完成的项目保留为预览限制，不写成通过。
7. 为最终发布提交创建 `v0.4.0` 标签，发布 GitHub prerelease。若同名标签已存在，先核对，不覆盖已有标签。发布正文可使用 [RELEASE-NOTES.md](RELEASE-NOTES.md)。
8. 从标签对应源码生成安装 ZIP，根部直接含 manifest；随附 `SHA256SUMS.txt`。如发布方改过任何文件，重新打包并计算哈希，不能沿用交接包哈希。
9. 匿名下载 Release ZIP，核对 SHA-256；检查源码 ZIP 中入口位置。把提交、CI、Release、下载哈希与安装结果回传给对接人。

README 中“本地预览交付、尚未提交”等状态文字，只有在实际上线并核验后才能更新；改文档产生的新提交也应成为最终检查和标签的目标。

## 安装与更新说明

发布后可向用户发送：

> 酒馆「扩展 → 安装扩展」先输入数据库链接 `https://github.com/AlbusKen/shujuku`，安装后刷新；再输入工作台链接 `https://github.com/hc568871650-commits/tavern-narrative-workbench`，再次刷新。已安装工作台的用户可在扩展管理中检查更新。进入世界卡聊天并完成表格适配后，可用「人物图片」给 NPC 绑定立绘。动作仍只加入输入草稿，不自动发送或扣物品。当前是预览版，手机真机等兼容范围见验收说明。

粘贴仓库首页 URL，不使用 README、`tree/main`、`raw` 或 Release 下载链接。依赖声明不会自动下载数据库。本包是前端扩展，不是 APK；手机需要访问支持第三方扩展的酒馆实例。

## 数据与回退

图片配置保存于角色卡扩展元数据，图片文件保存于酒馆用户图片目录；聊天适配与业务状态仍分别由聊天、数据库保存。同卡图片共享不等于多个聊天的剧情状态共享。

更新前用酒馆/数据库导出重要存档；已有图片资料另用「导出含图资源包」。若有界面故障，可先停用工作台并刷新。代码回退使用撤销提交或已验证旧版本，保留新增数据和图片，不自动清除。代码回退不能撤销已写入的存档变化。
