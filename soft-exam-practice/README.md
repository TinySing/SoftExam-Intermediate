# SoftExam Practice

SoftExam 的独立模拟做题系统，使用 React + TypeScript 前端和 SQLite 数据库。

## 本地开发

在仓库根目录运行：

```bash
npm run dev:practice
```

访问 Vite 输出的地址即可。开发命令会同时启动前端和 API，首次启动会从 `question-bank/soft-exam-practice.sqlite` 复制一份可写数据库到 `data/`。

## 能力范围

- 选择历年选择题试卷或章节批次
- 真实选择选项、切题、标记待检查、题号导航和倒计时
- 交卷后自动评分、查看答案和解析
- 选择历年案例试卷，输入自己的答案并查看参考答案
- SQLite 直接保存题目、试卷、答题记录和错题，后续可继续向数据库增加题目

当前题库已从仓库内历年选择题、案例题和案例计算题 PDF 导入，共 83 套试卷、803 道题。

## 配置

复制 `.env.example` 为 `.env` 后可配置：

- `VITE_DOCS_URL`：资料站地址
- `VITE_BASE_PATH`：前端部署路径，本地默认 `/`，线上使用 `/practice/`
- `VITE_API_BASE_URL`：API 地址前缀，本地默认 `/api`，线上使用 `/practice-api`
- `PORT`：API 端口，默认 `4000`

## 部署边界

- 独立构建：`npm run build`
- 独立产物：`dist/`
- API 进程：`npm run start`
- 当前线上使用 `https://tinybits.cc/practice/`，API 使用同域名的 `/practice-api/`

## 自动部署

根目录的 GitHub Actions 会在 `soft-exam-practice/` 发生变更时构建前端，并把前端产物、服务端代码和 SQLite 题库同步到服务器。配置以下额外机密变量后，`PRACTICE_RESTART_COMMAND` 会负责重启 API 进程：

- `PRACTICE_WEB_PATH`：前端静态文件目录
- `PRACTICE_APP_PATH`：服务端目录
- `PRACTICE_RESTART_COMMAND`：服务器上的重启命令，当前为 `sudo systemctl restart soft-exam-practice`

服务器首次配置时参考 `deploy/nginx.conf` 和 `deploy/soft-exam-practice.service`。当前线上规划使用同域名路径：前端为 `/practice/`，接口为 `/practice-api/`，不会占用资料站及其他系统已有的 `/api/`。做题系统中的资料入口设置 `DOCS_PUBLIC_URL`；如以后改用独立域名，再设置 `PUBLIC_PRACTICE_URL`。
