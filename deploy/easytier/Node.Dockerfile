FROM --platform=$BUILDPLATFORM golang:1.27.3-alpine3.23 AS build
ARG TARGETOS
ARG TARGETARCH
ARG ENB_VERSION=0.2.1-enb-permissions.1
WORKDIR /src
ENV GODEBUG=http2client=0 CGO_ENABLED=0
# Let the target build fetch only its dependencies. `go mod download` without
# arguments also downloads large Android/iOS libraries not used by Linux Nodes.
COPY lite-plus-agent/ ./
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build GOOS=$TARGETOS GOARCH=$TARGETARCH go build -tags with_quic,with_utls -trimpath -ldflags="-s -w -X github.com/nuomiiiii/lite-agent/update.CurrentVersion=${ENB_VERSION}" -o /out/Lite-Plus-agent .
FROM alpine:3.23
RUN apk add --no-cache ca-certificates tzdata && touch /.lite-plus-agent-container /.lite-agent-container /.komari-agent-container
WORKDIR /app
ENV GODEBUG=disablethp=1
COPY --from=build /out/Lite-Plus-agent /app/Lite-Plus-agent
ENTRYPOINT ["/app/Lite-Plus-agent"]
CMD ["--help"]
