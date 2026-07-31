# 构建器阶段
# 使用当前仓库上下文构建（不再 git clone 上游，适配 fork / GHCR Action）
FROM node:20-alpine AS builder

RUN apk add --no-cache git make python3 py3-pip build-base

WORKDIR /app

# 先拷依赖清单，利用 Docker 层缓存
COPY package.json package-lock.json ./

# 有 package-lock 时用 npm ci 更稳；跳过 puppeteer 浏览器下载
ENV PUPPETEER_SKIP_DOWNLOAD=1
RUN npm ci --omit=dev || npm install --omit=dev

# 拷贝完整源码（.dockerignore 控制体积）
COPY . .

# Alpine 下终端用 sh
RUN sed -i "s|const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash'|const shell = os.platform() === 'win32' ? 'powershell.exe' : 'sh'|" controllers/admin/terminalController.js || true

# 去掉不需要打进运行镜像的子项目/大目录
RUN rm -rf drpy-node-admin drpy-node-bundle drpy-node-mcp drpy2-quickjs .git

# 预构建配置快照（若脚本存在）
RUN if [ -f scripts/build-config-snapshots.mjs ]; then node scripts/build-config-snapshots.mjs || true; fi

# 运行器阶段：更小的运行时镜像
FROM alpine:latest AS runner

WORKDIR /app

COPY --from=builder /app /app

RUN if [ -f /app/.env.development ]; then \
      cp /app/.env.development /app/.env && rm -f /app/.env.development; \
    fi && \
    if [ -f /app/.env ]; then \
      sed -i 's|^VIRTUAL_ENV[[:space:]]*=[[:space:]]*$|VIRTUAL_ENV=/app/.venv|' /app/.env || true; \
      sed -i 's|^ENABLE_TERMINAL=0|ENABLE_TERMINAL=1|' /app/.env || true; \
    fi && \
    mkdir -p /app/config && \
    if [ ! -f /app/config/env.json ]; then \
      echo '{"ali_token":"","ali_refresh_token":"","quark_cookie":"","uc_cookie":"","bili_cookie":"","thread":"10","enable_dr2":"1","enable_py":"2"}' > /app/config/env.json; \
    fi

RUN apk add --no-cache nodejs \
    php83 \
    php83-cli \
    php83-curl \
    php83-mbstring \
    php83-xml \
    php83-pdo \
    php83-pdo_mysql \
    php83-pdo_sqlite \
    php83-openssl \
    php83-sqlite3 \
    php83-json \
    python3 \
    py3-pip \
    py3-setuptools \
    py3-wheel \
    && ln -sf /usr/bin/php83 /usr/bin/php

# Python 虚拟环境（采集/部分 py 源用）
RUN if [ -f /app/spider/py/base/requirements.txt ]; then \
      python3 -m venv /app/.venv && \
      . /app/.venv/bin/activate && \
      pip3 install --no-cache-dir -r /app/spider/py/base/requirements.txt; \
    fi

EXPOSE 5757

CMD ["node", "index.js"]
