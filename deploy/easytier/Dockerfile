ARG EASYTIER_IMAGE
FROM ${EASYTIER_IMAGE} AS easytier
FROM --platform=$BUILDPLATFORM node:26-alpine3.23 AS frontend
WORKDIR /web
COPY lite-plus-web/package*.json ./
RUN npm ci --no-audit --no-fund
COPY lite-plus-web/ ./
RUN npm run build
COPY enb-theme/ /enb-theme/
RUN ln -sfn /web/node_modules /enb-theme/node_modules && npm --prefix /enb-theme run build
FROM golang:1.27.3-alpine3.23 AS build
RUN apk add --no-cache gcc musl-dev
WORKDIR /src
COPY lite-plus/ .
COPY --from=frontend /web/dist ./web/public/systemUI/dist
COPY --from=frontend /enb-theme/Lite-theme.json ./web/public/bundledThemes/enb-theme/Lite-theme.json
COPY --from=frontend /enb-theme/preview.png ./web/public/bundledThemes/enb-theme/preview.png
COPY --from=frontend /enb-theme/dist ./web/public/bundledThemes/enb-theme/dist
ENV CGO_ENABLED=1 GODEBUG=http2client=0
ARG ENB_VERSION=0.0.5
ARG ENB_REVISION=unknown
RUN --mount=type=cache,id=enb-head-modules,target=/go/pkg/mod --mount=type=cache,id=enb-head-build,target=/root/.cache/go-build go build -trimpath -ldflags "-s -w -linkmode external -extldflags '-static' -X github.com/nuomiiiii/lite/utils.CurrentVersion=${ENB_VERSION} -X github.com/nuomiiiii/lite/utils.VersionHash=${ENB_REVISION}" -o /out/Lite .
FROM alpine:3.23
ARG ENB_VERSION=0.0.5
ARG ENB_REVISION=unknown
LABEL org.opencontainers.image.version=$ENB_VERSION org.opencontainers.image.revision=$ENB_REVISION org.opencontainers.image.source="https://github.com/NodokaQwQ/EasyNetworkBuilder" io.enb.component="head"
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
ENV GIN_MODE=release LITE_DEPLOYMENT=docker TZ=Asia/Shanghai
# Verify this path against the pinned EasyTier image before building.
COPY --from=easytier /usr/local/bin/easytier-cli /usr/local/bin/easytier-cli
COPY --from=build /out/Lite /app/Lite
CMD ["/app/Lite", "server"]
