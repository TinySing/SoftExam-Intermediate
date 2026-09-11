# SoftExam 自动部署配置教程

本文记录本仓库当前使用的完整发布流程。配置完成后，日常只需要在 Obsidian 修改 `SoftExam/`，提交并推送到 GitHub 的 `main` 分支，网站就会自动更新。

## 1. 当前地址与目录

- GitHub 仓库：<https://github.com/TinySing/SoftExam-Intermediate>
- 网站地址：<https://tinybits.cc/soft-exam/>
- 服务器：`119.29.152.130`
- SSH 端口：`2222`
- 网站目录：`/var/www/soft-exam`
- 服务器入口：Nginx

仓库中的目录职责如下：

```text
SoftExam-Intermediate/
├── SoftExam/                    # Obsidian 维护的唯一内容源
├── soft-exam-web/               # Astro + Starlight 网站工程
├── .github/workflows/deploy.yml # GitHub Actions 自动部署配置
└── DEPLOYMENT.md                # 本教程
```

`SoftExam/` 会随仓库公开，网站构建时从这里读取内容。PDF、`node_modules`、构建缓存和 Obsidian 本地工作区配置不会提交。

## 2. 自动部署是怎么工作的

配置文件是 `.github/workflows/deploy.yml`。它只监听 `main` 分支，并且只有以下内容发生变化时才运行：

- `SoftExam/**`
- `soft-exam-web/**`
- `.github/workflows/deploy.yml`

每次触发后，GitHub Actions 会依次完成：

1. 下载仓库代码。
2. 使用 Node.js 22 安装网站依赖。
3. 执行网站构建，读取 `SoftExam/` 并生成页面和 Pagefind 搜索索引。
4. 使用专用 SSH 密钥连接服务器。
5. 将 `soft-exam-web/dist/` 同步到 `/var/www/soft-exam/`。

服务器上的 Nginx 将 `/var/www/soft-exam/` 映射为 `/soft-exam/`，所以最终访问地址是：

<https://tinybits.cc/soft-exam/>

## 3. GitHub Actions Secrets 配置

进入仓库：

1. 打开 <https://github.com/TinySing/SoftExam-Intermediate>。
2. 点击 **Settings**。
3. 左侧进入 **Secrets and variables → Actions**。
4. 点击 **New repository secret**，逐项创建下面 5 个 Secret。

| Secret 名称 | 当前值 | 用途 |
| --- | --- | --- |
| `DEPLOY_HOST` | `119.29.152.130` | 服务器地址 |
| `DEPLOY_PORT` | `2222` | SSH 端口 |
| `DEPLOY_USER` | `root` | SSH 登录用户 |
| `DEPLOY_PATH` | `/var/www/soft-exam` | 网站上传目录 |
| `DEPLOY_SSH_KEY` | 专用 SSH 私钥全文 | GitHub Actions 登录服务器 |

GitHub 只会显示 Secret 的名称和更新时间，不会再次显示 Secret 的值。如果私钥泄露或需要更换，应删除旧 Secret，生成新密钥，并同时替换服务器上的公钥。

## 4. SSH 部署密钥配置

GitHub Actions 使用密钥登录，不使用服务器登录密码。推荐为自动部署单独生成一对 Ed25519 密钥：

```bash
ssh-keygen -t ed25519 -C "github-actions-soft-exam" -f ~/.ssh/soft-exam-deploy
```

命令会生成两个文件：

- `~/.ssh/soft-exam-deploy`：私钥，只粘贴到 GitHub Secret `DEPLOY_SSH_KEY`，不要提交到仓库。
- `~/.ssh/soft-exam-deploy.pub`：公钥，追加到服务器对应用户的 `~/.ssh/authorized_keys`。

服务器端权限应为：

```bash
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

配置完成后，可以用私钥测试登录：

```bash
ssh -i ~/.ssh/soft-exam-deploy -p 2222 root@119.29.152.130
```

当前仓库已经配置好了专用部署密钥。不要把私钥写进 Markdown、代码、截图或聊天记录。

## 5. 服务器 Nginx 配置

服务器现有的 `tinybits.cc` 首页和其他项目不能被覆盖。需要在现有 HTTPS `server` 块中、通用 `location /` 之前加入：

```nginx
location = /soft-exam {
    return 301 /soft-exam/;
}

location /soft-exam/ {
    root /var/www;
    index index.html;
    try_files $uri $uri/ /soft-exam/404.html;
}
```

首次配置目录：

```bash
mkdir -p /var/www/soft-exam
```

修改配置后先检查，再平滑重载：

```bash
nginx -t
systemctl reload nginx
```

不要删除或覆盖现有的 `/opt/home/dist`、`/radar/`、`/console/`、`/history/`、`/personal/` 等配置。

## 6. 日常更新流程

### Obsidian 用户

1. 在 Obsidian 中继续编辑 `SoftExam/`。
2. 保存笔记。
3. 将修改提交并推送到 `main`。

命令行示例：

```bash
git add SoftExam
git commit -m "更新学习笔记"
git push origin main
```

推送后打开仓库的 **Actions** 页面，查看 `Deploy SoftExam` 工作流。绿色表示成功，黄色表示运行中，红色表示失败。

### 修改网站代码

如果修改了 `soft-exam-web/` 中的样式、配置或同步脚本，同样提交并推送到 `main` 即可：

```bash
git add soft-exam-web
git commit -m "调整网站样式"
git push origin main
```

通常等待一到两分钟后刷新网站即可看到新版本。

## 7. 本地预览与搜索

开发模式用于快速预览样式，但 Starlight 的 Pagefind 搜索索引只在正式构建时生成。因此开发地址下搜索可能提示“搜索仅适用于生产版本”，这属于正常行为。

正式网站地址下搜索可用：

<https://tinybits.cc/soft-exam/>

## 8. 排错顺序

### 工作流没有启动

- 确认推送的是 `main` 分支。
- 确认修改路径在 `SoftExam/`、`soft-exam-web/` 或工作流文件范围内。
- 检查仓库的 **Actions** 是否被禁用。

### 工作流在 SSH 步骤失败

- 检查 5 个 Secrets 名称是否完全一致。
- 检查 `DEPLOY_SSH_KEY` 是否是私钥全文，包含首尾行。
- 检查服务器端 `authorized_keys` 是否包含对应公钥。
- 检查服务器 SSH 端口是否仍为 `2222`。

### 网站返回 404

- 检查服务器目录是否为 `/var/www/soft-exam`。
- 检查 Nginx 是否包含 `/soft-exam/` 路由。
- 执行 `nginx -t` 确认配置无误后再重载。
- 访问时保留结尾斜杠：`https://tinybits.cc/soft-exam/`。

### 页面更新了但搜索没有结果

- 等待 GitHub Actions 完成，不要只看代码是否已经上传。
- 确认正式网站的 `/soft-exam/pagefind/` 目录存在。
- 浏览器执行强制刷新，排除旧缓存。

## 9. 安全注意事项

- 不要把服务器密码提交到 GitHub。
- 不要把 SSH 私钥提交到仓库或发到公开聊天中。
- 当前自动部署使用 `root` + 专用密钥，功能正常但权限较高；后续可以改为只拥有 `/var/www/soft-exam` 写权限的专用部署用户。
- 如果不再使用自动部署，应删除 GitHub Secret，并从服务器 `authorized_keys` 中删除对应公钥。
