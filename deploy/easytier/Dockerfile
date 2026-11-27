ARG EASYTIER_IMAGE
FROM ${EASYTIER_IMAGE} AS easytier
FROM golang:1.27.3-alpine3.23 AS build
RUN apk add --no-cache gcc musl-dev
WORKDIR /src
COPY lite-plus/ .
ENV CGO_ENABLED=1 GODEBUG=http2client=0
RUN go build -trimpath -ldflags '-s -w -linkmode external -extldflags "-static"' -o /out/Lite .
FROM alpine:3.23
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
# Verify this path against the pinned EasyTier image before building.
COPY --from=easytier /usr/local/bin/easytier-cli /usr/local/bin/easytier-cli
COPY --from=build /out/Lite /app/Lite
CMD ["/app/Lite", "server"]
