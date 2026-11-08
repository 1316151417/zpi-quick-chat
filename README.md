# ZPI Quick Chat

独立、轻量的 macOS 悬浮对话工具，通过 CLI 启动 Electron 进程，无需安装独立桌面应用。后端依赖 `@zpi-dev/agent-sdk`；前端是独立的 HTML、CSS、TypeScript，没有引入 ZPI 的前端包。

```sh
export DEEPSEEK_API_KEY='你的 API Key'
npx @zpi-dev/quick-chat
```

需要固定命令时可安装到全局：

```sh
npm install -g @zpi-dev/quick-chat
zpi-quick-chat
```

需要 Node.js 24 和 Apple Silicon Mac（macOS arm64）。SDK 从 npm 安装，使用者不需要 ZPI 仓库。安装时需要允许 Electron 的安装脚本下载运行环境。

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | 无 | 必填；缺失时在启动窗口前直接报错 |
| `ZPI_QUICK_CHAT_MODEL` | `deepseek` | 当前只支持 DeepSeek；使用 SDK 内置 DeepSeek Flash 模型 |
| `ZPI_QUICK_CHAT_REASONING` | `disable` | `disable` 或 `low`；不提供模型配置页 |

| 快捷键 | 动作 |
| --- | --- |
| Option + Space | 显示或隐藏快速对话 |
| Option + Shift + Space | 清空并新建对话 |
| Option + Shift + C | 复制当前应用选中文字并带入草稿 |
| Option + Shift + V | 带入剪贴板文字或图片 |
| Option + Shift + A | 框选截图并带入草稿 |
| Enter / Shift + Enter | 发送 / 换行 |
| Escape | 隐藏，恢复之前应用的焦点 |

保留多轮上下文、流式回复、停止生成、图片粘贴/带入/截图、复制回复。正文按纯文本显示。会话异常终止时保留显示内容，需新建对话后继续。输入和带入内容需要主动发送；关闭或新建时清空临时会话，不写入 ZPI 任务或历史。不注册 ZPI 的快捷键、不加载项目配置、不提供本机工具。文字最多 32000 字，单张图片最多 10 MiB、最多 5 张。单段临时对话最多 200 条消息、32 MiB 内容，超过后提示新建。

选择文字需要 macOS 辅助功能权限，截图使用系统截图权限。所有权限均随用户实际调用，由系统控制。Esc 或 Option+Space 隐藏窗口；CLI Ctrl+C 退出进程并释放快捷键。快捷键被占用时启动会明确报错。

开发需要 Node.js 24、macOS 和 Xcode Command Line Tools（编译选区复制与焦点恢复助手）。发行包包含 arm64 原生产物，构建发布包需要使用 Apple Silicon Mac。SDK 依赖固定版本的 `@zpi-dev/agent-sdk`，更新时安装新的 npm 版本并提交锁文件。

从源码启动：

```sh
npm install
npm run build
npm start
```

发布新版本时，先确认新 SDK 已经发布到 npm，再更新依赖和自己的版本：

```sh
npm install @zpi-dev/agent-sdk@latest --save-exact
npm version patch --no-git-tag-version
npm run check
npm test
npm run build
npm run test:desktop
# 提交并推送版本号、依赖和锁文件的改动
npm publish --access=public
```

`prepack` 会自动构建发布产物。按 npm 提示完成浏览器认证后，使用 `npm view @zpi-dev/quick-chat version` 和 `npx @zpi-dev/quick-chat --version` 确认公开版本。

```sh
npm run check
npm test
npm run test:desktop
```

自动桌面测试复制独立 Electron bundle、使用专属临时数据目录、隐藏窗口、禁止激活和系统剪贴板/截图/快捷键，模型请求只走本机测试服务。真实跨应用选区、截图和系统焦点需按 [人工验收清单](docs/manual-testing.md) 手动验收。
