// Package dockerupdate talks only to the explicitly mounted ENB updater socket.
// The Head never receives access to the Docker daemon.
package dockerupdate

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"time"
)

type Release struct {
	Version      string   `json:"version"`
	Hash         string   `json:"hash"`
	Image        string   `json:"image"`
	Notes        string   `json:"notes"`
	PublishedAt  string   `json:"published_at"`
	FromVersions []string `json:"from_versions"`
}

func Call(ctx context.Context, method, path string, body any, result any) error {
	socket := os.Getenv("ENB_UPDATER_SOCKET")
	if socket == "" {
		return errors.New("ENB host updater is not configured")
	}
	if path != "/status" && path != "/releases" && path != "/start" {
		return errors.New("invalid updater endpoint")
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, "unix", socket)
	}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 30 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	req, err := http.NewRequestWithContext(ctx, method, "http://enb-updater"+path, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return errors.New("ENB host updater is unavailable")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return errors.New("ENB updater rejected request; check approved release, active task and host recovery status")
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, (1<<20)+1))
	if err != nil || len(data) > 1<<20 {
		return errors.New("invalid updater response")
	}
	return json.Unmarshal(data, result)
}
