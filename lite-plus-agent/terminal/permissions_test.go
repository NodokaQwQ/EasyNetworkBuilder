package terminal

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	pkg_flags "github.com/nuomiiiii/lite-agent/cmd/flags"
)

func TestFilesOnlySessionDoesNotStartShell(t *testing.T) {
	old := pkg_flags.GlobalConfig
	pkg_flags.GlobalConfig = &pkg_flags.Config{RemoteControlEnabled: true, RemotePermissions: "files"}
	defer func() { pkg_flags.GlobalConfig = old }()
	done := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(done)
		c, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close()
		StartRemoteSession(c)
	}))
	defer server.Close()
	c, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	c.SetReadDeadline(time.Now().Add(5 * time.Second))
	var ready map[string]any
	if err = c.ReadJSON(&ready); err != nil {
		t.Fatal(err)
	}
	if ready["type"] != "remote.ready" || ready["terminal_enabled"] != false || ready["files_enabled"] != true {
		t.Fatal(ready)
	}
	if err = c.WriteJSON(map[string]any{"type": "file.roots", "id": "roots"}); err != nil {
		t.Fatal(err)
	}
	var response map[string]any
	if err = c.ReadJSON(&response); err != nil {
		t.Fatal(err)
	}
	if response["type"] != "file.response" || response["ok"] != true {
		t.Fatal(response)
	}
	c.Close()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("files-only session leaked")
	}
}

func TestMCPTerminalRequiresIndependentMCPGrant(t *testing.T) {
	old := pkg_flags.GlobalConfig
	pkg_flags.GlobalConfig = &pkg_flags.Config{RemoteControlEnabled: true, RemotePermissions: "terminal"}
	defer func() { pkg_flags.GlobalConfig = old }()
	done := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(done)
		c, e := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if e != nil {
			return
		}
		defer c.Close()
		StartRemoteSessionForSource(c, true)
	}))
	defer server.Close()
	c, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	c.SetReadDeadline(time.Now().Add(5 * time.Second))
	var response map[string]any
	if err = c.ReadJSON(&response); err != nil {
		t.Fatal(err)
	}
	if response["type"] != "remote.error" {
		t.Fatal("MCP terminal opened without mcp", response)
	}
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("rejected session leaked")
	}
}
