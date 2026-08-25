# Web 架构与端适配

## 目标

课序只维护一个业务本体，通过端适配层支持微信小程序、手机 Web 和 PC Web。学生端与教务后台属于同一个 Web 项目、同一个构建产物和同一个域名，仅通过路由和用户角色区分。

```text
                     ┌─ 微信小程序适配：wx 存储 / wx.cloud / 小程序导航
共享业务与接口核心 ──┼─ 浏览器适配：localStorage / fetch / History API
                     └─ 未来 PC 壳适配：复用 Web 构建，无需重写业务
                              │
                              ▼
                  Node API + 选课领域规则 + MySQL
```

## 代码边界

### `packages/client-core`

不依赖 DOM、React 或 `wx`，负责：

- API 请求与错误模型
- 会话存储协议
- 角色到默认路由的映射
- 课程卡片和课表视图模型
- 报名幂等键生成

新增端时优先复用这里，不复制课程和课表数据转换逻辑。

### `apps/web`

统一 Web 应用，负责浏览器运行时与 UI：

- `/login`：学生和教职工统一入口
- `/courses/*`、`/enrollments`、`/schedule`、`/profile`：学生端
- `/admin/*`：教务后台
- 大于 820px：PC 侧边导航、双栏/表格布局
- 小于等于 820px：手机底部导航、单列卡片和触控布局

所有 API 使用同源 `/api/*`，部署时不需要维护两套 CORS 和接口地址。

### `miniprogram`

保留微信专属能力：

- `wx.login`
- `wx.cloud.callContainer`
- 微信存储和导航

小程序 UI 不与 Web 共用组件，但应逐步改用 `client-core` 的构建产物处理平台无关的数据转换；微信能力仅留在小程序适配层。

### `server`

业务事实来源：鉴权、容量、报名幂等、时间冲突、权限和持久化都必须由服务端校验。客户端共享核心只负责展示和调用，不能代替服务端规则。

## 部署边界

生产容器同时包含 Web 静态文件和 Node API：

```text
浏览器 → Caddy HTTPS → Node :8080
                         ├─ /api/*      API
                         ├─ /admin/*    Web 管理路由
                         └─ 其他路由    Web 学生端
```

MySQL 只连接 Docker 内部网络，不开放公网 3306。
