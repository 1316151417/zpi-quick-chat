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

保留多轮上下文、流式回复、停止生成、图片粘贴/带入/截图、图片预览、消息复制。回答用 Marked 渲染 Markdown，支持标题、列表、引用、表格和可复制代码块；用户长消息沿用 ZPI 的 120px 折叠与展开。工作中显示实时耗时、分隔线及加载图标，完成后保留耗时和回答时间。只在停留底部时跟随流式输出，向上滚动、选择文字或展开历史后保持阅读位置，回到底部后恢复跟随。会话异常终止时保留显示内容，需新建对话后继续。输入和带入内容需要主动发送；退出或新建时清空临时会话，不写入 ZPI 任务或历史。不注册 ZPI 的其他快捷键、不加载项目配置。文字最多 32000 字，主动带入的图片每张最多 10 MiB、最多 5 张。单段临时对话最多 200 条消息、32 MiB 内容（含显示的工具文字和图片记录），超过后提示新建。

发送按钮左侧提供联网搜索（地球仪）和本机工具（终端）两个开关，默认均关闭，可独立开启。第一条消息被接受后，开关隐藏，工具配置与工作目录在整段会话中保持不变；新建会话恢复全部关闭，发送前的输入校验失败不会锁定开关。窗口顶部悬停可查看本会话的工具配置，本机工具图标悬停可查看工作目录。

联网沿用 ZPI 的 `web_search` / `web_fetch` 定义，复用 `DEEPSEEK_API_KEY`；请求限时 30 秒，响应不超过 2 MiB，传入模型的网页文字不超过 32000 字。复制按钮后提供“来源”浮窗，按本次真实工具结果去重展示网页标题、站点和摘要，点击可在默认浏览器打开。正文保留相关引用链接，省略已有来源的重复列表。原始 HTML 不执行，Markdown 中的远程图片显示为可主动打开的链接。

所有会话统一以用户主目录 `~/` 为 `cwd`，由 SDK 默认提供工作目录上下文。本机工具同时开放 SDK 原生 `Bash` 和 `Read`：Bash 可查找文件、执行命令，Read 可按路径读取文字和图片，沿用 SDK 的图片格式识别和压缩处理。开启后可读写文件和访问网络，`cwd` 不构成目录隔离。例如可直接提问“看看 ~/Desktop/error.png 的报错”或“找到下载目录里的最新截图并分析”，无需主动复制图片。执行时按原顺序展示说明与工具，搜索显示摘要行，终端可展开查看命令和结果，本地读取显示文件路径，读到的图片显示可点击预览的缩略图；正常完成后整个过程自动折叠，最后一段回答留在外面，可点击“已工作”回看。停止或出错时保留过程展开。不额外限制每次提问的模型调用轮数，长任务可点击停止后继续同一会话；Bash 默认超时 60 秒，仅以前台方式执行，停止和新建都会取消正在运行的工具。会话异常关闭时保留 SDK 的具体错误原因和已有内容。

窗口沿用 ZPI 的快速对话布局：初始为屏幕下方的 360×44 输入条，随多行输入和图片增高，发送后展开为 660×560 对话窗。输入区最多显示 7 行左右，超出后内部滚动；对话窗内输入区最高 160px。在可见对话窗中新建仍保留大窗；隐藏后恢复空白且无草稿的会话时收回输入条。输入条不显示图钉，失焦即隐藏；对话窗默认也不固定，手动点击右上角图钉后才会在失焦时保留，再次点击恢复失焦隐藏，新会话恢复不固定。两种模式均可通过 Esc 或 Option+Space 隐藏。隐藏保留会话与草稿，新建或退出清空临时会话。

输入条和大窗口在本次运行期间分别记住最后拖拽的位置，隐藏后再次打开、新建会话或切换模式时恢复对应位置；图片预览使用大窗口的位置。输入条增高时保持底边位置，屏幕布局变化后自动将窗口限制在可见工作区。未拖拽时仍默认显示在屏幕下方，退出程序后位置重置。

系统提示词：你是一个有用的助手，帮助用户完成任务。要求回复极简、本质、清晰、易懂。

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

自动桌面测试复制独立 Electron bundle、使用专属临时数据目录、隐藏窗口、禁止激活和系统剪贴板/截图/快捷键及外部浏览器访问，模型与搜索请求均只走本机测试服务。Bash/Read 用例仅操作测试定义的临时目录文件。真实跨应用选区、截图、系统焦点和模型识图效果需按 [人工验收清单](docs/manual-testing.md) 手动验收。
