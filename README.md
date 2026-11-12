# Agentero × DeepSeek Harness

[Agentero](https://github.com/poco-ai/Agentero) 是本地优先的科研工作台。这个插件把它的文献库、笔记和 PDF 阅读器带进 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（下称 dsh），让 Agent 和你坐在同一个窗口里做科研：你读论文、做判断，Agent 帮你查资料、翻笔记、整理结论。所有资料都留在自己的本地。

![文献库与 PDF 阅读](assets/pdf-library.png)

## 一起做科研

- 聊天在中间，论文在右边，读到哪句可以直接丢回对话。
- Agent 能查你已经有的文献和笔记，回答时引用真实的本地论文。
- 讨论完可以让 Agent 把结论整理成笔记，下次接着用。
- 新论文让 Agent 按 arXiv、DOI 或链接导入，不用手动整理文件。

可以这样说：

> 帮我把这个方向近两年的论文找出来，导入文献库，再结合我的笔记整理一份提纲。

> 把这轮讨论整理成一篇阅读笔记，开头列出用到的论文。

![Agent 在对话中写笔记](assets/note.png)

## 能做什么

- **读文献**：搜索、标签、导入、补下载、删除到回收站。
- **读 PDF**：翻页、查找、目录、链接；划词后复制、高亮、批注、翻译或加入对话。
- **全文翻译**：用 dsh 配置的 DeepSeek 模型在原页面上逐段替换，保留公式和版面。
- **写笔记**：编辑自己的笔记，也可以让 Agent 代写；每篇论文还有自己的专属笔记。
- **让 Agent 动手**：查文献、导入论文、读和搜笔记、整理提纲。

## 安装

需要 dsh 0.2.x、Node.js 24.9+、一个 Agentero Vault，以及 Agentero CLI。

插件已发布到 npm，直接安装：

```sh
dsh plugin --profile web add agentero-dsh
```

启动：

```sh
dsh web --no-open
```

看到 `[agentero] plugin loaded` 后打开终端打印的链接。在侧边栏「插件」中打开 `agentero-dsh`，点击 `agentero-host` 行的「配置」；也可以从「更多」→「设置」→「Agentero」进入同一份配置表单：

- **Agentero CLI**：点右侧「安装」会从 GitHub Release 下载与本机匹配的官方 CLI，校验 SHA-256 后写入用户目录，并把可执行文件路径填好。桌面端已经装过 CLI 时可直接复用。
- **新建知识库**：选择一个目录，插件调用 `agentero vault create` 生成 `papers/`、`notes/`、`.agentero/catalog.sqlite` 等结构并切换过去。已有 Vault 仍用「选择目录」打开。

![在 dsh 设置中查看 CLI 状态、创建知识库，并进入 Agentero 桌面版](assets/settings.png)

也可以手动安装 CLI：在 Agentero 桌面端打开「设置 → 关于 → 安装 CLI」，或参考 [CONTRIBUTING.md](CONTRIBUTING.md) 本地构建。确认终端里能运行：

```sh
agentero --help
```

配置会直接保存到当前 dsh profile，不需要手动编辑 `cordis.patch.yml`。设置页选择的知识库目录会立即生效；CLI 路径留空则使用 PATH 里的 `agentero`。

### 域名与反向代理访问

Agentero API 复用 dsh 的登录认证和请求来源检查。通过自定义域名访问时，将对外提供服务的 `host[:port]` 加入 dsh 的 `trustedHosts`，让反向代理保留原始 `Host` 与 `Origin`，并在浏览器中完成 dsh 登录。未登录请求返回 401，未受信任的域名或跨站请求返回 403。

## 数据

论文、PDF、笔记和标注都留在 Vault 里，和 [Agentero 桌面端](https://github.com/poco-ai/Agentero) 共用。插件只在本机运行，不另建数据库。

## 桌面版

插件把 Agentero 的 Vault 带进 dsh；[Agentero 桌面版](https://github.com/poco-ai/Agentero) 提供完整的本地工作台：文献管理、PDF 标注、OCR、全文翻译、写作与 Agent 协作。两边共用同一个 Vault，可以按场景切换。

[下载 Agentero 桌面版](https://github.com/poco-ai/Agentero/releases/latest)

## 已知限制

- 扫描件需要先在桌面端做 OCR 和版面分析。
- 全文翻译重新打开文档会重新计算；译文上的原文链接和高亮暂不支持。

## 开发

见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 交流反馈

<p align="center">
  <img src="assets/community-qr.png" alt="Agentero 交流群二维码" width="240" />
  <br/>
  <sub>扫码加入微信群；也可以到 <a href="https://github.com/poco-ai/Agentero/issues">Agentero Issues</a> 反馈。二维码 7 天内有效。</sub>
</p>
