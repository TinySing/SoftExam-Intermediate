# SoftExam Web

这是 `SoftExam/` 的 Starlight 网站工程，不会修改任何笔记文件。

## 内容同步方式

每次开发或发布时，脚本读取相邻目录中的 `../SoftExam`，生成 Starlight 所需的页面源文件：

```text
SoftExam-Intermediate/
├── SoftExam/          # 继续在 Obsidian 里维护的唯一内容源
└── soft-exam-web/     # 网站程序
```

所以，你只需要继续在 Obsidian 编辑 `SoftExam/`；推送代码后，GitHub Actions 会自动重新生成并把新版本同步到服务器。

## 本地启动

需要 Node.js 22 或更高版本。在 `soft-exam-web/` 目录运行：

```bash
npm run dev
```

然后打开命令行显示的本地地址。

## 部署准备

根目录中的 [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) 已经包含自动发布流程：推送 `main` 分支后，GitHub 会构建并把 `dist/` 静态网站同步到服务器。

首次启用自动发布时，需要：

- 在 GitHub 仓库设置中配置 `DEPLOY_HOST`、`DEPLOY_PORT`、`DEPLOY_USER`、`DEPLOY_PATH`、`DEPLOY_SSH_KEY` 五项机密变量。
- 在服务器创建 `/var/www/soft-exam` 目录，并配置 `deploy/nginx.conf`。
- 将 GitHub Actions 使用的 SSH 公钥加入服务器的授权列表。

部署前只需把 Nginx 配置里的域名替换为实际域名。首次部署时需要检查服务器现有网站与 Nginx 配置，避免覆盖已有服务。

资料站头部的“模拟做题”入口在本地默认跳转到 `http://localhost:4322/`，线上通过 `PUBLIC_PRACTICE_URL` 配置做题系统地址。
