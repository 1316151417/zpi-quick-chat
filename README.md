# ZPI Quick Chat

独立、轻量的 macOS 悬浮对话工具，通过 npm 分发，由 CLI 启动 Electron 进程。后端依赖 `@zpi-dev/agent-sdk`；前端是独立的 HTML、CSS、TypeScript，没有引入 ZPI 的前端包。

## 安装与运行

推荐安装 Node.js 24，设置模型 API Key 后，通过 npx 直接运行：

```sh
export DEEPSEEK_API_KEY='你的 API Key'
npx @zpi-dev/quick-chat
```

需要固定命令时，通过 npm 安装到全局后执行（同样需要先设置 `DEEPSEEK_API_KEY`）：

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

保留多轮上下文、流式回复、停止生成、图片粘贴/带入/截图、图片预览、复制回复。正文按纯文本显示。会话异常终止时保留显示内容，需新建对话后继续。输入和带入内容需要主动发送；退出或新建时清空临时会话，不写入 ZPI 任务或历史。不注册 ZPI 的其他快捷键、不加载项目配置、不提供本机工具。文字最多 32000 字，单张图片最多 10 MiB、最多 5 张。单段临时对话最多 200 条消息、32 MiB 内容，超过后提示新建。

窗口沿用 ZPI 的快速对话布局：初始为屏幕下方的 360×44 输入条，随多行输入和图片增高，发送后展开为 660×560 对话窗。输入区最多显示 7 行左右，超出后内部滚动；对话窗内输入区最高 160px。在可见对话窗中新建仍保留大窗；隐藏后恢复空白且无草稿的会话时收回输入条。输入条不显示图钉，失焦即隐藏；对话窗默认也不固定，手动点击右上角图钉后才会在失焦时保留，再次点击恢复失焦隐藏，新会话恢复不固定。两种模式均可通过 Esc 或 Option+Space 隐藏。隐藏保留会话与草稿，新建或退出清空临时会话。

系统提示词：你是一个有用的助手，帮助用户解答问题、翻译和处理日常事务，回复极简、本质、清晰、易懂，常规问题不超过3句话，复杂问题按需展开，翻译默认只给译文。

选择文字需要 macOS 辅助功能权限，截图使用系统截图权限。所有权限均随用户实际调用，由系统控制。Esc 或 Option+Space 隐藏窗口；CLI Ctrl+C 退出进程并释放快捷键。快捷键被占用时启动会明确报错。

## 升级

退出 Quick Chat 后，执行 `npx @zpi-dev/quick-chat@latest` 运行最新版。全局安装的用户重新执行 `npm install -g @zpi-dev/quick-chat@latest`，然后运行 `zpi-quick-chat`；仍需设置 `DEEPSEEK_API_KEY`。

## 开发与 npm 发布

开发需要 Node.js 24、macOS 和 Xcode Command Line Tools（编译选区复制与焦点恢复助手）。npm 包包含 arm64 原生产物，构建 npm 包需要使用 Apple Silicon Mac。

当前依赖 npm 正式版本 `@zpi-dev/agent-sdk@0.1.63`，版本与锁文件一并保留，`npm install` / `npm ci` 可复现依赖。Quick Chat 始终设置 `persistSession: false`，多轮上下文只保留在进程内存中，不配置外部会话镜像。

从源码启动：

```sh
npm install
npm run build
npm start
```

发布新版本时，先将对应版本的 SDK 发布到 npm，再更新 SDK 依赖和自己的版本：

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
