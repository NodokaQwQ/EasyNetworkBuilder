package dockerupdate

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"path/filepath"
	"testing"
)

func TestSocketClient(t *testing.T) {
	path := filepath.Join(t.TempDir(), "updater.sock")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/start" {
			var body map[string]string
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body["version"] != "0.3.0" {
				t.Error("invalid start body")
			}
			w.WriteHeader(http.StatusAccepted)
		}
		_, _ = w.Write([]byte(`{"supported":true}`))
	})}
	go server.Serve(listener)
	t.Cleanup(func() { _ = server.Close() })
	t.Setenv("ENB_UPDATER_SOCKET", path)
	var result map[string]any
	if err := Call(context.Background(), "GET", "/status", nil, &result); err != nil {
		t.Fatal(err)
	}
	if result["supported"] != true {
		t.Fatal(result)
	}
	if err := Call(context.Background(), "POST", "/start", map[string]string{"version": "0.3.0"}, &result); err != nil {
		t.Fatal(err)
	}
	if err := Call(context.Background(), "GET", "/arbitrary", nil, &result); err == nil {
		t.Fatal("accepted arbitrary endpoint")
	}
}

func TestUnconfiguredClient(t *testing.T) {
	t.Setenv("ENB_UPDATER_SOCKET", "")
	var result any
	if err := Call(context.Background(), "GET", "/status", nil, &result); err == nil {
		t.Fatal("accepted missing socket")
	}
}
