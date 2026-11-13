# Agent Note: Account-bound shared library proposal

Status: proposed

English | [中文](2026-11-10-account-bound-shared-library.zh.md)

## Problem

Deepseek-harness needs a WorkBuddy-like shared content space where members manage online documents and uploaded files, and agents read, create, and modify the same materials. Materials must survive sessions and device changes, with access controlled by the signed-in account.

This is the second proposal, dated 2026-11-12. The first version (2026-11-10) planned a self-built library service and document editor. The second version instead deploys the open-source document system Outline on a server with Feishu sign-in, and Desktop only embeds it and connects agents. The initial collection contains tens to hundreds of materials, and the target server is 172.24.126.12. This document does not authorize server deployment or product code changes.

See the [WorkBuddy shared library platform selection report](2026-11-12-workbuddy-library-platform-selection.md) for the selection review. It recommends OpenCloud instead of this proposal's Outline choice, restores independent files and the conversation picker, and corrects account-ID mapping and HTTP MCP credential-storage assumptions. This document retains the Outline proposal and Feishu experiment evidence; it does not authorize implementation as written.

## Proposal

### Summary

Deploy Outline 1.12.0 on the server as the library. Outline already provides an online document editor, collections (the shared spaces), membership and roles, uploaded attachments, search, import and export, and real-time collaborative editing. Outline offers only Feishu sign-in: members are provisioned automatically after Feishu authorization and join the same workspace.

Desktop adds a Library sidebar entry that embeds the Outline web interface, and agents read and write the same documents through Outline's built-in MCP endpoint. This repository adds no library service, library database, or document editor.

### Review navigation

| Review subject | Section |
|---|---|
| Why Outline, and whether its license permits this use | Summary, License |
| Whether Feishu sign-in already works | Feishu sign-in verification |
| Included features | Included features |
| Accounts, membership, and permissions | Accounts and permissions |
| Desktop integration and signing in only once | Desktop integration |
| How agents read and write documents | Agent integration |
| Server deployment and backup | Deployment and persistence |
| Choices requiring confirmation | Review items |

### WorkBuddy evidence

The reference tree is `E:\Project\workbuddy-5.9.3-src`. It is an extracted installation reference: the library interface loads remotely, and the library server source is absent, so it supports a feature comparison but no implementation reuse.

| Confirmed behavior | Reference relative to the WorkBuddy tree | Outline equivalent |
|---|---|---|
| Team spaces have membership roles, and a node tree organizes folders and content | `resources/plugins/workbuddy-builtin/skills/library/manage/entry.md` | Collections and their members; documents nest child documents |
| Online documents support reading, creation, and editing; creation accepts Markdown | `resources/plugins/workbuddy-builtin/skills/library/doc/entry.md`, `resources/plugins/workbuddy-builtin/skills/library/doc/tasks/read_create.md` | Rich-text editor; import and MCP writes accept Markdown |
| Uploaded files are independent material nodes; replacement can preserve the node and link | `resources/plugins/workbuddy-builtin/skills/library/drive/entry.md` | No equivalent: attachments live inside documents rather than as independent nodes |
| The conversation picker expands spaces and folders, allows multiple selections, and inserts references | `renderer/assets/space-library-picker-J0ZX7Dk-.js` | Desktop must build it; see Agent integration |
| Online documents export as Markdown, and files retain original downloads | `resources/plugins/workbuddy-builtin/skills/library/export/entry.md`, `resources/plugins/workbuddy-builtin/skills/library/drive/entry.md` | Documents export as Markdown or HTML; attachments download as originals |
| Remote resources supply the complete library interface | `resources/extensions/library/extension.json`, `resources/extensions/library/ui/assets/remoteEntry.js` | Desktop likewise embeds a remote page |

### Feishu sign-in verification

Verification ran locally on 2026-11-12 under Docker in WSL with Outline 1.12.0, PostgreSQL 17, and Redis 7 at `http://localhost:3100`. It used the existing Desktop Feishu app, with the callback `http://localhost:3100/auth/oidc.callback` registered under the app's security settings.

Outline ran unmodified, connected to Feishu only through its OIDC sign-in configuration:

| Setting | Value |
|---|---|
| Authorization page `OIDC_AUTH_URI` | `https://accounts.feishu.cn/open-apis/authen/v1/authorize` |
| Token exchange `OIDC_TOKEN_URI` | `https://open.feishu.cn/open-apis/authen/v2/oauth/token` |
| User information `OIDC_USERINFO_URI` | `https://passport.feishu.cn/suite/passport/oauth/userinfo` |
| Requested scopes `OIDC_SCOPES` | `offline_access contact:user.email:readonly` |

User information uses Feishu's legacy endpoint because it returns the `sub`, `name`, `email`, and `picture` fields Outline expects; the current `authen/v1/user_info` nests them under `data`, which Outline cannot read. Feishu publishes no OIDC discovery document, so each endpoint is configured explicitly.

| Check | Result |
|---|---|
| First sign-in | Feishu authorization returned to Outline, which provisioned the user from the Feishu account; the first user became administrator |
| Email | The company email arrived; the workspace subdomain derived from the email domain is `longcheer` |
| Renewal | A refresh_token arrived, and the token lasts 2 hours |
| Automatic renewal | After the token was marked as about to expire, a page reload made Outline renew it and the user stayed signed in |
| Sign-in after sign-out | In a browser already signed in to Feishu web, signing in again after sign-out succeeded in about 9 seconds without a QR scan |

Once a sign-in is an hour old, Outline periodically checks it with Feishu while the user is active (at most every 5 minutes); it renews a token that is about to expire and signs the user out when renewal or the check fails. Verification also found that renewal requests omit scopes, so a renewed token carries every scope enabled on that Feishu app (including Bitable reads and contact search) rather than only the requested email scope. Outline uses it only to confirm identity, but stores the token encrypted in its database. Production should use a dedicated Feishu app for the library with only the email scope enabled.

### Included features

| Feature | First-version behavior | Source |
|---|---|---|
| Feishu sign-in | Only Feishu sign-in appears; members are provisioned after authorization | Outline configuration |
| Shared spaces | Collections serve as spaces; administrators create and name them | Outline |
| Space members | Grant manage, edit, or read-only access to members or groups | Outline |
| Folder structure | Documents nest child documents and can be dragged to reorder | Outline |
| Online documents | Headings, lists, tables, images, code blocks, links, and more; autosave; real-time multiuser editing and version history | Outline |
| Uploaded files | Upload as document attachments with original downloads; PDFs can be previewed inline in a document | Outline |
| Search | Title and full-text search | Outline |
| Material links | Every document has a stable link checked against access on open | Outline |
| Import and export | Import Markdown, Word (.docx), and HTML; export Markdown and HTML (the community edition lacks PDF export) | Outline |
| Library entry | A Desktop sidebar entry opens the embedded Outline page | New in this repository |
| Agent reads and writes | Agents list, read, create, and modify documents through Outline MCP | Integrated by this repository |

This version excludes anonymous public sharing (disabled in Outline), file nodes independent of documents, a material picker in the conversation composer, and a native Desktop library interface. These require separate review.

### Accounts and permissions

Outline keeps Feishu as its only sign-in method, so the library adds no user-facing account or password. Users and space permissions live in Outline:

| Concept | Outline equivalent |
|---|---|
| Account | An Outline user with the Feishu open_id as external account ID and the email for display and ownership |
| Workspace | A self-hosted deployment has one workspace, which every member joins |
| Workspace roles | Administrator, member, viewer, and guest; administrators set the default role for new members |
| Space | A collection, either open to the workspace or visible only to selected members and groups |
| Space permissions | Manage, can edit, and read-only |

The first user to sign in becomes administrator. Anyone who can authorize through the Feishu app, meaning members of this company within the app's availability scope, can sign in and joins the workspace on first sign-in. Administrators can further restrict allowed email domains in Outline or switch to invitation-only. Outline's Personal area serves as a personal space when needed.

When a user switches Feishu accounts in Desktop, the library signs the previous account out of Outline at the same time so its pages stop showing; the next section describes how. A sign-in invalidated on the Feishu side is signed out at Outline's next check.

### Desktop integration

#### Library entry

Register Library in the sidebar panel list the same way the market panel registers ([ui-market](../../../../packages/client/ui-market/README.md)). Selecting it makes the Desktop main process show an Outline web view in the content area, loading the server's Outline address. The web view keeps the existing embedded-page restrictions: navigation stays between Outline and the Feishu authorization pages, other links open in the system browser, the page gets no Node access, and permission requests such as camera access are denied.

```text
Desktop 侧边栏 ─ 资料库 ─ 内嵌网页视图（持久保存的浏览器会话）
                              │
                              ├─ Outline 页面 ─ 服务器 Outline
                              └─ 飞书授权页 ─ 飞书
```

#### Signing in only once

The current Desktop Feishu sign-in window uses a fresh temporary browser session for every attempt so that switching accounts always shows a QR code; see [sign-in-window.ts](../../../../apps/desktop/src/sign-in-window.ts). The cost is that the Feishu web sign-in from the scan disappears when the window closes, so an embedded Outline page cannot reuse it.

This version changes that:

1. The Feishu sign-in window and the library web view share one persistent browser session.
2. After the user scans to sign in to Desktop, the Feishu web sign-in remains in that session.
3. Opening the library makes Outline redirect to Feishu, which recognizes the signed-in state and returns without another scan.
4. When the user signs out of Desktop or switches Feishu accounts, Desktop clears that session so the Outline and Feishu web sign-ins end together, and the next sign-in shows a QR code again.

Local verification confirmed that in a browser signed in to Feishu web, signing in to Outline again after sign-out needs no QR scan. Whether Feishu still asks the user to click Authorize at that point, and whether clearing the session in step 4 reliably brings back the QR code, require verification inside Desktop.

### Agent integration

Outline provides an `/mcp` endpoint over Streamable HTTP, authenticated with `Authorization: Bearer <API key>`, which an administrator enables in Outline settings. Version 1.12.0 provides these tools:

| Operation | Outline MCP tools |
|---|---|
| Browse | `list_collections`, `list_documents`, `list_collection_documents` |
| Read | `fetch` |
| Create | `create_collection`, `create_document`, `create_attachment` |
| Modify | `update_document`, `move_document`, `update_collection` |
| History | `get_document_changes` |
| Delete | `delete_document`, `delete_collection` |

The `patch` mode of `update_document` finds a Markdown fragment and replaces only the match, preserving formatting elsewhere in the document, so no custom block-editing interface is needed.

This version connects through the existing market connectors: add Outline MCP in [market connectors](../../../../packages/market/market-connectors/README.md), with the API key saved in local credentials through connector settings and kept out of model input, tool arguments, and session history. Agents act as the user who created the API key, with that user's Outline permissions.

Each user first creates an API key in Outline settings and enters it in Desktop. Outline's API-key creation endpoint accepts only web sign-in, so Desktop could in principle create and save a key automatically after the user opens the library; this is unverified and deferred to a later version. Whether agents get the deletion tools is confirmed under Review items.

### Deployment and persistence

Server 172.24.126.12 runs three containers: Outline, PostgreSQL, and Redis.

| Item | First-version recommendation |
|---|---|
| Version | Pin `outlinewiki/outline:1.12.0` rather than `latest` |
| Address | An intranet address or domain chosen at deployment; it determines the Feishu callback `<address>/auth/oidc.callback` |
| HTTPS | Recommended; plain intranet http requires `FORCE_HTTPS=false` |
| Attachment storage | Local server disk (`FILE_STORAGE=local`); move to S3-compatible storage as volume grows |
| Network | The server must reach `accounts.feishu.cn`, `open.feishu.cn`, and `passport.feishu.cn` |
| Public sharing | Disabled |

Materials are not stored in the `\\172.24.126.12\worksapce\lc-camera-agent` share: the database and attachments stay on local server disk so ordinary members cannot bypass Outline permissions by reading or writing the share directly. The existing market and installer directories remain unchanged.

Backups cover the PostgreSQL database and the attachment directory together; Redis holds only caches and job queues and needs no backup. Backup intervals, retention, and attachment size limits are confirmed at deployment.

### License

Outline uses the Business Source License 1.1. Its Additional Use Grant permits production use, forbidding only offering it as a "Document Service" that lets third parties other than employees and contractors create their own teams and documents. This proposal serves only company members, which satisfies that condition. Version 1.12.0 converts to Apache 2.0 on 2030-10-23.

### Implementation order

| Stage | Deliverables | Verification outcome |
|---|---|---|
| 0. Feishu sign-in verification | Local Docker deployment and Feishu sign-in configuration | Complete; see Feishu sign-in verification |
| 1. Server deployment | Dedicated Feishu app, server deployment, public sharing disabled, backups | Two colleagues sign in with Feishu, join one workspace, and see collection permissions take effect |
| 2. Desktop library entry | Sidebar entry, embedded web view, and the shared persistent sign-in session | After a Desktop scan, opening the library needs no second scan; after an account switch the library shows the new account |
| 3. Agent integration | Outline MCP connector and API-key settings | Agent-created documents appear in the library; patch edits preserve other formatting |

### Review items

| Item | Recommendation | Confirmation needed |
|---|---|---|
| Library approach | Deploy Outline instead of building a library service | Acceptance of Outline's interface and feature scope |
| Feishu app | Create a dedicated app for the library with only the email scope | Whether to create it, and company administrator review |
| Server | Docker on 172.24.126.12 | Operating system, Docker, access to Feishu endpoints, intranet address or domain, HTTPS certificate |
| File management | Files are document attachments | Acceptance of having no independent file nodes |
| Agent deletion | Withhold deletion tools from agents in the first version | Agreement |

## Alternatives considered

**Build the library service and editor (the first proposal).** The first version planned a self-built library service, membership, revision checks, a Lexical-based document editor, and a block-editing interface for agents. Outline already provides these, plus real-time collaboration, version history, full-text search, and MCP. Building it would allow an interface fully native to Desktop and files as independent nodes, but requires developing and maintaining a complete document system, so it was dropped.

**Docmost.** Its editing experience is similar and it uses the AGPL, but API access, single sign-on, and AI features are paid (6 USD per user per month, 10-user minimum), so the free edition supports neither agent access nor Feishu sign-in.

**Use Feishu cloud documents directly.** Feishu already has complete cloud documents, permissions, and mobile apps, and agents could use Feishu's open APIs. But materials would live in Feishu's cloud rather than on the intranet server, and document scopes need company administrator approval. If materials may live in Feishu's cloud, this is the least work and deserves separate evaluation.

**Let every client directly write the shared folder.** This stores files but makes account permissions, stable links, and online editing difficult to coordinate, with paths and concurrent writes handled separately on each device.

**Add an identity relay between Outline and Feishu.** A relay could exchange the Feishu token Desktop already holds for an Outline sign-in, avoiding a second Feishu authorization. Verification showed that a shared persistent browser session already avoids a second scan, while a relay needs a self-implemented OIDC server, so it is not used for now.

## Acceptance criteria

1. Outline runs on the server showing only Feishu sign-in; two colleagues sign in with Feishu and join the same workspace automatically.
2. An administrator creates a collection and selects its members; nonmembers cannot see it, and read-only members cannot edit.
3. Content created, edited, uploaded, or imported in the library appears for another member after refresh and survives a server restart.
4. Public sharing is disabled; signed-out users can neither open documents nor download attachments.
5. After a Feishu scan in Desktop, opening the library needs no second scan.
6. After a Feishu account switch in Desktop, the library shows the new account and retains none of the previous account's pages or sign-in state.
7. The library web view reaches only Outline and the Feishu authorization pages; other links open in the system browser.
8. With the Outline MCP connector configured, agents list, read, and create documents, and patch-mode edits leave other formatting intact; the API key never appears in session history.
9. After restoring from backup, documents, attachments, members, and links remain usable.

## Risks

**Dependence on Feishu's legacy user-information endpoint.** The `passport.feishu.cn` user-information endpoint used for sign-in is marked historical in Feishu's documentation. If Feishu retires it, deploy a small adapter that calls the current endpoint and reshapes the fields for Outline; that adapter is already prepared in the verification environment.

**Renewed tokens carry excess scopes.** Renewal requests omit scopes, so Outline stores a Feishu token carrying every app scope. A dedicated Feishu app with only the email scope removes this risk.

**The interface is not native to Desktop.** The library is an embedded Outline page whose styling and interaction differ from the rest of Desktop and which cannot reuse Desktop's file previews. A material picker in conversations needs separate development.

**Files are not independent nodes.** Uploaded files attach to documents and cannot be managed separately like a network drive. If that is a hard requirement, choose another approach or develop it separately.

**Dependence on an external project's upgrades.** A third party maintains Outline, and upgrades may change configuration or MCP tools. Deploy a pinned version and re-verify Feishu sign-in and MCP in a test environment before upgrading.

**Server availability.** The library is unavailable when the server or database fails, and data safety depends on regular backups.

### Implementation references

These references identify reusable current mechanisms and limits without implying this proposal has been implemented.

- [Application architecture](../../../../docs/architecture.md): Cordis plugins and profile launch.
- [Feishu account](../../../../packages/credentials/feishu-account/README.md) and [Feishu account interface](../../../../packages/client/ui-account-feishu/README.md): existing Desktop Feishu sign-in, sign-out, and switching.
- [Desktop application](../../../../apps/desktop/README.md): the main process, embedded web views, and the in-app sign-in window.
- [Market interface](../../../../packages/client/ui-market/README.md): sidebar panel registration.
- [Market connectors](../../../../packages/market/market-connectors/README.md): custom MCP connectors and connector credential settings.
