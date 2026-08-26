# 腾讯云香港部署

这一套部署同时提供学生 Web、PC 宽屏界面、教务后台和 API：

- `https://zhongwei-edu.com/`：统一登录入口
- `https://zhongwei-edu.com/courses`：学生志愿填报
- `https://zhongwei-edu.com/admin`：教务后台
- `https://zhongwei-edu.com/api/health`：健康检查

## 服务器准备

建议使用腾讯云香港地域的 Linux 轻量应用服务器，安全组仅开放：

- TCP 22：SSH，最好限制为管理员固定 IP
- TCP 80：Caddy 申请证书和 HTTP 跳转
- TCP/UDP 443：HTTPS 与 HTTP/3

不要开放 3306；MySQL 只在 Docker 内部网络中访问。

服务器需要安装 Docker Engine、Docker Compose 插件和 Git。

## 首次上线

1. 将仓库克隆到服务器。
2. 进入部署目录并创建生产环境变量：

   ```bash
   cd miniapp/deploy/tencent-hk
   cp .env.example .env
   ```

3. 编辑 `.env`，填写三个不同的随机密码/密钥。`PUBLIC_ORIGIN` 可省略，默认使用 `https://zhongwei-edu.com`。
4. 构建并启动：

   ```bash
   docker compose up -d --build
   ```

5. 查看状态：

   ```bash
   docker compose ps
   docker compose logs -f app caddy
   ```

部署前确认 `zhongwei-edu.com` 和 `www.zhongwei-edu.com` 的 A 记录都指向服务器公网 IP，然后构建启动：

   ```bash
   docker compose up -d --build
   ```

Caddy 会在域名解析生效且 80/443 可访问后自动申请和续期 HTTPS 证书。旧域名 `sparkluv-ai.cc` 会保留为永久跳转，不再作为主入口。

## 更新代码

```bash
git pull --ff-only
cd deploy/tencent-hk
docker compose up -d --build
```

应用容器可随时重建，业务数据保存在 `mysql_data` Docker 卷中。Redis 只保存短时缓存、限流计数和学生操作锁，重启不会丢失业务数据。

志愿提交不按先后抢占名额。后台模拟与发布按教学组串行执行，分配结果受项目容量限制；MySQL 保存最终业务数据，Redis 只用于短时缓存和限流。不要用 Redis 缓存代替 MySQL 业务数据。

## GitHub 自动部署

仓库包含 `.github/workflows/deploy.yml`。合并到 `master` 后会先运行测试和 Web 构建，通过后再更新服务器。

生产环境需要配置以下 GitHub Secrets：

- `DEPLOY_HOST`：服务器公网 IP
- `DEPLOY_USER`：仅用于部署的 SSH 用户，当前为 `ubuntu`
- `DEPLOY_SSH_KEY`：专用部署私钥，不要复用个人登录密钥

工作流使用 `production` 环境和并发锁，同一时间只执行一次生产部署。

## 备份

上线前先建立每日备份任务。手动备份示例：

```bash
docker compose exec -T mysql sh -c 'exec mysqldump -ukexu -p"$MYSQL_PASSWORD" kexu' > kexu-backup.sql
```

备份文件应复制到另一台机器或对象存储，不能只保留在当前服务器。

## 正式使用前清除演示数据

仓库内置的课程、学生、教师和报名仅用于验收。不要使用 `server/tools/reset.js` 清理生产库，
因为它会在下次启动时重新生成演示数据。服务器上请使用：

```bash
cd /home/ubuntu/miniapp/deploy/tencent-hk
./clear-demo-data.sh --confirm-clear-demo-data
```

脚本会先停止应用写入并备份 MySQL，然后一次清除学生、教师、课程、排课、报名和基础资料；
管理员账号与系统规则会保留。清理后依次维护基础资料、导入学生，再导入课程。
