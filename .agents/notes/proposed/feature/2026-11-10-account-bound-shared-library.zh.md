# Agent Note: 账号绑定的共用资料空间方案书

Status: proposed

[English](2026-11-10-account-bound-shared-library.md) | 中文

## Problem

当前 deepseek-harness 需要提供类似 WorkBuddy 的共用资料空间，让成员在同一个空间内管理在线文档和上传文件，并让 agent（智能体）读取、创建和修改同一份资料。资料需要跨会话、跨设备保留，并按照登录账号控制访问。

本文是第二版方案，日期为 2026-11-12。第一版（2026-11-10）计划自建资料服务和文档编辑器；第二版改为在服务器部署开源文档系统 Outline，用飞书账号登录，Desktop 只负责嵌入和接入 agent。资料规模按几十到几百份设计；部署目标服务器为 172.24.126.12。本文未授权在服务器部署或修改产品代码。

选型复核见 [WorkBuddy 共用资料空间开源项目选型报告](2026-11-12-workbuddy-library-platform-selection.zh.md)。新报告建议用 OpenCloud 替代本文的 Outline 选型，恢复独立文件和对话资料选择器，并修正账号 ID 映射及 HTTP MCP 凭据保存假设。本文保留 Outline 方案及飞书登录实验依据，不代表已批准按本文实施。

## Proposal

### 方案摘要

在服务器部署 Outline 1.12.0 作为资料库。Outline 自带在线文档编辑器、文档集（即共用空间）、成员与角色、上传附件、搜索、导入导出和实时协同编辑。Outline 只开放“飞书登录”一种方式：成员在飞书授权后自动建账号，并进入同一个工作区。

Desktop 增加“资料库”侧边栏入口，在应用内嵌入 Outline 网页；agent 通过 Outline 自带的 MCP 接口读写同一份文档。本仓库不新增资料服务、资料数据库或文档编辑器。

### 审核导航

| 审核内容 | 对应章节 |
|---|---|
| 为什么改用 Outline，许可是否允许 | 方案摘要、许可 |
| 飞书登录是否已经可用 | 飞书登录验证 |
| 本期提供哪些功能 | 本期功能 |
| 账号、成员和权限如何对应 | 账号与权限 |
| Desktop 怎么接入，如何只登录一次 | Desktop 接入 |
| agent 如何读写文档 | agent 接入 |
| 服务器如何部署和备份 | 部署与保存 |
| 需要确认的选择 | 待审核事项 |

### WorkBuddy 参考依据

参考代码为 `E:\Project\workbuddy-5.9.3-src`。该目录是安装包解包参考树，资料库主界面通过远程页面加载，资料服务端源码不在其中，因此只能对照功能，不能复用实现。

| 已确认行为 | 参考位置，相对于 WorkBuddy 参考树 | Outline 中的对应 |
|---|---|---|
| 团队空间有成员角色，空间内通过节点树组织目录和内容 | `resources/plugins/workbuddy-builtin/skills/library/manage/entry.md` | 文档集及其成员；文档可嵌套子文档 |
| 在线文档支持读取、创建和编辑；新建入口接受 Markdown | `resources/plugins/workbuddy-builtin/skills/library/doc/entry.md`、`resources/plugins/workbuddy-builtin/skills/library/doc/tasks/read_create.md` | 富文本编辑器；导入和 MCP 写入均接受 Markdown |
| 上传文件是独立资料节点，替换文件可以保持节点和链接 | `resources/plugins/workbuddy-builtin/skills/library/drive/entry.md` | 不对应：附件嵌在文档内，不是独立节点 |
| 对话选择器可展开空间和目录、多选资料并插入引用 | `renderer/assets/space-library-picker-J0ZX7Dk-.js` | 需要 Desktop 自行实现，见 agent 接入 |
| 在线文档可导出 Markdown，文件可下载原件 | `resources/plugins/workbuddy-builtin/skills/library/export/entry.md`、`resources/plugins/workbuddy-builtin/skills/library/drive/entry.md` | 文档可导出 Markdown、HTML；附件可下载 |
| 完整资料库界面由远程资源加载 | `resources/extensions/library/extension.json`、`resources/extensions/library/ui/assets/remoteEntry.js` | Desktop 同样嵌入远程页面 |

### 飞书登录验证

2026-11-12 在本机完成验证，环境为 WSL 中的 Docker：Outline 1.12.0、PostgreSQL 17、Redis 7，地址为 `http://localhost:3100`。验证使用 Desktop 现有飞书应用，并在应用的“安全设置”中登记了回调地址 `http://localhost:3100/auth/oidc.callback`。

Outline 未修改代码，只通过它的 OIDC 登录配置接入飞书：

| 配置项 | 值 |
|---|---|
| 授权页 `OIDC_AUTH_URI` | `https://accounts.feishu.cn/open-apis/authen/v1/authorize` |
| 换取 token `OIDC_TOKEN_URI` | `https://open.feishu.cn/open-apis/authen/v2/oauth/token` |
| 用户信息 `OIDC_USERINFO_URI` | `https://passport.feishu.cn/suite/passport/oauth/userinfo` |
| 申请权限 `OIDC_SCOPES` | `offline_access contact:user.email:readonly` |

用户信息使用飞书旧版接口，因为它直接返回 Outline 需要的 `sub`、`name`、`email` 和 `picture` 字段；新版 `authen/v1/user_info` 把字段放在 `data` 内，Outline 无法读取。飞书没有提供 OIDC 自动发现地址，因此必须逐项配置。

| 检查项 | 结果 |
|---|---|
| 首次登录 | 飞书授权后回到 Outline，按飞书账号自动创建用户，第一个用户成为管理员 |
| 邮箱 | 取得企业邮箱；工作区子域名按邮箱域名生成为 `longcheer` |
| 续期 | 取得 refresh_token，token 有效期 2 小时 |
| 自动续期 | 把 token 标记为即将过期后刷新页面，Outline 自动续期成功，用户保持登录 |
| 退出后再登录 | 在已登录飞书网页的浏览器中，退出后约 9 秒重新登录成功，未重新扫码 |

登录满 1 小时后，Outline 会在用户使用时定期向飞书核对登录是否有效（最多每 5 分钟一次）；token 将要过期时自动续期，续期或核对失败时让用户退出。验证还发现，续期请求不带权限范围，因此续期后的 token 带有该飞书应用开通的全部权限（包括多维表格读取和通讯录搜索），而不只是登录申请的邮箱权限。Outline 只用它确认身份，但 token 会加密保存在 Outline 数据库中。正式部署应为资料库创建只开通邮箱权限的独立飞书应用。

### 本期功能

| 功能 | 第一版行为 | 来源 |
|---|---|---|
| 飞书登录 | 只显示飞书登录；成员授权后自动建账号 | Outline 配置 |
| 共用空间 | 以文档集作为空间；管理员创建并命名 | Outline |
| 空间成员 | 按成员或成员组授予管理、编辑或只读权限 | Outline |
| 目录结构 | 文档下可嵌套子文档；可拖动调整位置 | Outline |
| 在线文档 | 标题、列表、表格、图片、代码块、链接等；自动保存；多人实时协同编辑和历史版本 | Outline |
| 上传文件 | 上传为文档内附件，可下载原件；PDF 可在文档中嵌入预览 | Outline |
| 查找 | 按标题和全文搜索 | Outline |
| 资料链接 | 每个文档有固定链接，打开时检查权限 | Outline |
| 导入导出 | 导入 Markdown、Word（.docx）和 HTML；导出 Markdown、HTML（社区版不提供 PDF 导出） | Outline |
| 资料库入口 | Desktop 侧边栏打开嵌入的 Outline 页面 | 本仓库新增 |
| agent 读写 | agent 通过 Outline MCP 列出、读取、创建和修改文档 | 本仓库接入 |

本期不包含：匿名公开分享（在 Outline 中关闭）、独立于文档的文件节点、对话输入框中的资料选择器，以及 Desktop 原生的资料库界面。这些需要单独审核。

### 账号与权限

Outline 只保留飞书一种登录方式，资料库不新增用户可见的账号或密码。用户和空间权限都保存在 Outline 中：

| 概念 | Outline 中的对应 |
|---|---|
| 账号 | Outline 用户，以飞书 open_id 作为外部账号 ID，邮箱作为显示和归属依据 |
| 工作区 | 自行部署时只有一个工作区，所有成员进入同一个 |
| 工作区角色 | 管理员、成员、只读成员、访客；新成员的默认角色由管理员设置 |
| 空间 | 文档集；可设为工作区内公开，或只对指定成员和成员组可见 |
| 空间权限 | 管理、可编辑、只读 |

第一个登录的用户成为管理员。能登录的是能通过该飞书应用授权的成员，即本企业中位于应用可用范围内的成员；他们首次登录后自动加入工作区。管理员可以在 Outline 中进一步限制允许的邮箱域名，或改为仅限邀请。需要个人空间时，可以使用 Outline 的“个人”区域。

用户在 Desktop 中切换飞书账号时，资料库同时退出旧账号的 Outline 登录，避免旧账号的页面继续显示，具体方式见下一节。飞书侧失效的登录，会在 Outline 下一次核对时被登出。

### Desktop 接入

#### 资料库入口

在侧边栏面板列表中注册“资料库”，注册方式与现有市场面板相同（[ui-market](../../../../packages/client/ui-market/README.zh.md)）。点击后，Desktop 主进程在内容区显示一个 Outline 网页视图，加载服务器上的 Outline 地址。该网页视图沿用现有内嵌网页的约束：只允许在 Outline 和飞书授权页之间跳转，其他链接用系统浏览器打开；不给网页开放 Node 能力，并拒绝摄像头等权限请求。

```text
Desktop 侧边栏 ─ 资料库 ─ 内嵌网页视图（持久保存的浏览器会话）
                              │
                              ├─ Outline 页面 ─ 服务器 Outline
                              └─ 飞书授权页 ─ 飞书
```

#### 只登录一次

Desktop 现在的飞书登录窗口每次都使用全新的临时浏览器会话，这样切换账号时一定会显示二维码；见 [sign-in-window.ts](../../../../apps/desktop/src/sign-in-window.ts)。代价是扫码后的飞书网页登录状态随窗口关闭而丢失，嵌入的 Outline 页面无法复用。

本期改为：

1. 飞书登录窗口和资料库网页视图共用一个持久保存的浏览器会话。
2. 用户在 Desktop 扫码登录后，飞书网页登录状态保留在这个会话中。
3. 打开资料库时，Outline 跳转到飞书；飞书识别到已登录状态后返回，用户不需要再扫码。
4. 用户在 Desktop 退出或切换飞书账号时，清空这个会话，使 Outline 和飞书网页登录一起失效，下次登录时重新显示二维码。

本机验证已确认，浏览器已登录飞书网页时，Outline 退出后再登录不需要扫码。飞书在此时是否还要求用户点击“授权”确认，以及第 4 步清空会话后能否稳定显示二维码，需要在 Desktop 中验证。

### agent 接入

Outline 提供 `/mcp` 接口（Streamable HTTP），使用 `Authorization: Bearer <API key>` 认证，需要管理员在 Outline 设置中开启。1.12.0 提供的工具包括：

| 操作 | Outline MCP 工具 |
|---|---|
| 浏览 | `list_collections`、`list_documents`、`list_collection_documents` |
| 读取 | `fetch` |
| 创建 | `create_collection`、`create_document`、`create_attachment` |
| 修改 | `update_document`、`move_document`、`update_collection` |
| 历史 | `get_document_changes` |
| 删除 | `delete_document`、`delete_collection` |

`update_document` 的 `patch` 模式按 Markdown 片段查找并只替换匹配部分，保留文档其余部分的格式；不需要自行实现按段落修改的接口。

本期通过现有市场连接器接入：在[市场连接器](../../../../packages/market/market-connectors/README.zh.md)中添加 Outline MCP，API key 通过连接器设置保存在本机凭据中，不进入模型输入、工具参数或会话记录。agent 以创建 API key 的用户身份操作，权限与该用户在 Outline 中的权限一致。

每个用户需要先在 Outline 设置中创建 API key，再填入 Desktop。Outline 创建 API key 的接口只接受网页登录状态，所以理论上 Desktop 可以在用户打开资料库后自动创建并保存 API key；这一点尚未验证，留到后续版本。删除类工具是否对 agent 开放，在待审核事项中确认。

### 部署与保存

服务器 172.24.126.12 运行 Outline、PostgreSQL 和 Redis 三个容器。

| 项目 | 第一版建议 |
|---|---|
| 版本 | 固定 `outlinewiki/outline:1.12.0`，不使用 `latest` |
| 访问地址 | 内网地址或域名，由部署时确定；它决定飞书回调地址 `<地址>/auth/oidc.callback` |
| HTTPS | 建议启用；只用内网 http 时设置 `FORCE_HTTPS=false` |
| 附件存储 | 服务器本地磁盘（`FILE_STORAGE=local`）；文件量增大后再改为 S3 兼容存储 |
| 网络 | 服务器需要能访问 `accounts.feishu.cn`、`open.feishu.cn` 和 `passport.feishu.cn` |
| 公开分享 | 关闭 |

不使用 `\\172.24.126.12\worksapce\lc-camera-agent` 共享目录保存资料：数据库和附件放在服务器本地磁盘，避免普通成员绕过 Outline 权限直接读写共享目录。现有市场目录和安装包目录保持不变。

备份同时覆盖 PostgreSQL 数据库和附件目录；Redis 只保存缓存和任务队列，不需要备份。备份周期、保留时间和附件大小上限在部署时确认。

### 许可

Outline 使用 Business Source License 1.1。附加使用授权允许生产使用，只禁止将它作为“文档服务”提供给员工和承包商以外的第三方，让第三方创建自己的团队和文档。本方案只供公司内部成员使用，符合该条件。1.12.0 于 2030-10-23 转为 Apache 2.0。

### 实施顺序

| 阶段 | 交付内容 | 验证结果 |
|---|---|---|
| 0. 飞书登录验证 | 本机 Docker 部署和飞书登录配置 | 已完成，见飞书登录验证 |
| 1. 服务器部署 | 独立飞书应用、服务器部署、关闭公开分享、备份 | 两名同事分别用飞书登录，进入同一个工作区；权限按文档集生效 |
| 2. Desktop 资料库入口 | 侧边栏入口、内嵌网页视图、共用的持久登录会话 | Desktop 扫码登录后打开资料库不需要再扫码；切换账号后资料库显示新账号 |
| 3. agent 接入 | Outline MCP 连接器和 API key 设置 | agent 创建的文档出现在资料库中；patch 修改保留其余格式 |

### 待审核事项

| 事项 | 本方案建议 | 需要确认的内容 |
|---|---|---|
| 资料库方案 | 部署 Outline，不自建资料服务 | 是否接受 Outline 的界面和功能范围 |
| 飞书应用 | 为资料库创建只开通邮箱权限的独立应用 | 是否新建应用，以及企业管理员审核 |
| 服务器 | 172.24.126.12 运行 Docker | 操作系统、Docker、可访问飞书接口、内网地址或域名、HTTPS 证书 |
| 文件管理 | 文件作为文档内附件 | 是否接受没有独立文件节点 |
| agent 删除权限 | 第一版不向 agent 开放删除工具 | 是否同意 |

## Alternatives considered

**自建资料服务和编辑器（第一版方案）。** 第一版计划自建资料服务、成员权限、版本检查和基于 Lexical 的文档编辑器，并为 agent 设计按段落修改的接口。Outline 已经提供这些功能，还包括实时协同、历史版本、全文搜索和 MCP。自建的优势是界面可完全融入 Desktop、文件可作为独立节点，但需要开发和维护完整的文档系统，因此放弃。

**Docmost。** 编辑体验相近，使用 AGPL 许可；但 API、单点登录和 AI 功能属于付费版（每人每月 6 美元，最少 10 人），免费版无法让 agent 读写，也无法接入飞书登录。

**直接使用飞书云文档。** 飞书已有完整的云文档、权限和移动端，agent 可以通过飞书开放接口读写。但资料保存在飞书云端而非内网服务器，并且需要申请文档相关权限并通过企业管理员审批。如果资料可以放在飞书云端，这是工作量最小的选择，需要单独评估。

**所有客户端直接读写共享文件夹。** 这种方式可以保存文件，但难以统一账号权限、固定资料链接和在线编辑，各设备需要分别处理路径和并发写入。

**在 Outline 和飞书之间增加身份中转服务。** 曾考虑由中转服务把 Desktop 已持有的飞书 token 换成 Outline 登录状态，以避免第二次飞书授权。验证表明，共用持久浏览器会话已经可以免去重新扫码，中转服务需要自行实现 OIDC 服务端，因此暂不采用。

## Acceptance criteria

1. Outline 部署在服务器上，只显示飞书登录；两名同事分别用飞书登录，自动进入同一个工作区。
2. 管理员创建文档集并指定成员；非成员看不到该文档集，只读成员不能编辑。
3. 在资料库中新建、编辑、上传和导入的内容，另一名成员刷新后可以看到；服务器重启后内容仍在。
4. 公开分享已关闭；未登录的用户无法打开文档或下载附件。
5. Desktop 中扫码登录飞书后，打开资料库不需要再次扫码。
6. Desktop 中切换飞书账号后，资料库显示新账号，不保留旧账号的页面和登录状态。
7. 资料库网页视图只能访问 Outline 和飞书授权页，其他链接在系统浏览器中打开。
8. 配置 Outline MCP 连接器后，agent 可以列出、读取和创建文档，用 patch 模式修改文档且其余格式不变；API key 不出现在会话记录中。
9. 备份恢复后，文档、附件、成员和链接仍可使用。

## Risks

**依赖飞书旧版用户信息接口。** 登录使用的 `passport.feishu.cn` 用户信息接口在飞书文档中标为历史版本。如果飞书停用该接口，需要改为部署一个小型转换服务，调用新版接口后整理成 Outline 需要的字段；该转换服务已在验证环境中准备。

**续期后的 token 权限过大。** 续期请求不带权限范围，Outline 会保存带有应用全部权限的飞书 token。使用只开通邮箱权限的独立飞书应用后，这一风险随之消除。

**界面不是 Desktop 原生的。** 资料库是嵌入的 Outline 网页，样式和交互与 Desktop 其他部分不同，也无法直接复用 Desktop 的文件预览。对话中的资料选择器需要另外开发。

**文件不是独立节点。** 上传的文件附在文档内，不能像网盘一样单独管理。若这是硬性需求，需要另选方案或另外开发。

**依赖外部项目的升级。** Outline 由第三方维护；升级可能改变配置或 MCP 工具。部署固定版本，升级前在测试环境重新验证飞书登录和 MCP。

**服务器可用性。** 服务器或数据库故障时资料库不可用；数据安全依赖定期备份。

### 实现依据

以下链接说明当前项目可以复用的机制和限制，不表示本方案已实现。

- [应用架构](../../../../docs/architecture.zh.md)：Cordis 插件和 profile 启动方式。
- [飞书账号](../../../../packages/credentials/feishu-account/README.zh.md)与[飞书账号界面](../../../../packages/client/ui-account-feishu/README.zh.md)：Desktop 现有飞书登录、退出和切换。
- [Desktop 应用](../../../../apps/desktop/README.zh.md)：主进程、内嵌网页视图和应用内登录窗口。
- [市场界面](../../../../packages/client/ui-market/README.zh.md)：侧边栏面板的注册方式。
- [市场连接器](../../../../packages/market/market-connectors/README.zh.md)：自定义 MCP 连接器和连接器凭据设置。
