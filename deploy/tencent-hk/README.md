# 腾讯云香港部署

这一套部署同时提供学生 Web、PC 宽屏界面、教务后台和 API：

- `https://你的域名/`：统一登录入口
- `https://你的域名/courses`：学生课程大厅
- `https://你的域名/admin`：教务后台
- `https://你的域名/api/health`：健康检查

## 服务器准备

建议使用腾讯云香港地域的 Linux 轻量应用服务器，安全组仅开放：

- TCP 22：SSH，最好限制为管理员固定 IP
- TCP 80：Caddy 申请证书和 HTTP 跳转
- TCP/UDP 443：HTTPS 与 HTTP/3

不要开放 3306；MySQL 只在 Docker 内部网络中访问。

服务器需要安装 Docker Engine、Docker Compose 插件和 Git。

## 首次上线（暂时没有域名）

1. 将仓库克隆到服务器。
2. 进入部署目录并创建生产环境变量：

   ```bash
   cd miniapp/deploy/tencent-hk
   cp .env.example .env
   ```

3. 编辑 `.env`：保留 `SITE_ADDRESS=:80`，将 `PUBLIC_ORIGIN` 改为 `http://服务器公网IP`，并填写三个不同的随机密码/密钥。
4. 构建并启动：

   ```bash
   docker compose up -d --build
   ```

5. 查看状态：

   ```bash
   docker compose ps
   docker compose logs -f app caddy
   ```

现在可以通过 `http://服务器公网IP` 访问。IP 测试阶段只有 HTTP，不要在公网环境长期使用真实用户密码。

## 以后绑定域名和 HTTPS

1. 将域名的 A 记录解析到服务器公网 IP。
2. 把 `.env` 改为：

   ```dotenv
   SITE_ADDRESS=course.example.com
   PUBLIC_ORIGIN=https://course.example.com
   ```

3. 重新构建启动：

   ```bash
   docker compose up -d --build
   ```

Caddy 会在域名解析生效且 80/443 可访问后自动申请和续期 HTTPS 证书。

## 更新代码

```bash
git pull --ff-only
cd deploy/tencent-hk
docker compose up -d --build
```

应用容器可随时重建，业务数据保存在 `mysql_data` Docker 卷中。Redis 只保存短时缓存、限流计数和学生操作锁，重启不会丢失业务数据。

高并发写入时，Redis 负责把同一学生的重复操作串行化；MySQL 课程行条件更新与报名唯一索引负责最终一致性和防超卖。不要用 Redis 缓存代替 MySQL 业务数据。

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
