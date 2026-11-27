ARG EASYTIER_IMAGE
FROM ${EASYTIER_IMAGE} AS easytier
FROM --platform=$BUILDPLATFORM node:26-alpine3.23 AS frontend
WORKDIR /web
COPY lite-plus-web/package*.json ./
RUN npm ci --no-audit --no-fund
COPY lite-plus-web/ ./
RUN npm run build
FROM golang:1.27.3-alpine3.23 AS build
RUN apk add --no-cache gcc musl-dev
WORKDIR /src
COPY lite-plus/ .
COPY --from=frontend /web/dist ./web/public/systemUI/dist
ENV CGO_ENABLED=1 GODEBUG=http2client=0
ARG ENB_VERSION=0.2.1-enb-easytier.1
ARG ENB_REVISION=unknown
RUN --mount=type=cache,id=enb-head-modules,target=/go/pkg/mod --mount=type=cache,id=enb-head-build,target=/root/.cache/go-build go build -trimpath -ldflags "-s -w -linkmode external -extldflags '-static' -X github.com/nuomiiiii/lite/utils.CurrentVersion=${ENB_VERSION} -X github.com/nuomiiiii/lite/utils.VersionHash=${ENB_REVISION}" -o /out/Lite .
FROM alpine:3.23
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
ENV GIN_MODE=release LITE_DEPLOYMENT=docker TZ=Asia/Shanghai
# Verify this path against the pinned EasyTier image before building.
COPY --from=easytier /usr/local/bin/easytier-cli /usr/local/bin/easytier-cli
COPY --from=build /out/Lite /app/Lite
CMD ["/app/Lite", "server"]
