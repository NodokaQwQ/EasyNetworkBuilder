package hostctl

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nuomiiiii/lite/database/accounts"
	"github.com/nuomiiiii/lite/virtualnet"
)

func TestSingleUseLoginBoundTickets(t *testing.T) {
	p := virtualnet.Profile{PeerID: "test-peer", AuthType: "password", Password: "encrypted-fixture"}
	for _, mode := range []string{"valid", "replay", "different-user", "different-login", "expired", "closed"} {
		t.Run(mode, func(t *testing.T) {
			key, err := Issue(p, 3, "user", "login")
			if err != nil {
				t.Fatal(err)
			}
			user, login := "user", "login"
			switch mode {
			case "different-user":
				user = "other"
			case "different-login":
				login = "other"
			case "expired":
				state.Lock()
				v := state.tickets[key]
				v.expires = time.Now().Add(-time.Second)
				state.tickets[key] = v
				state.Unlock()
			case "closed":
				ClosePeer(p.PeerID)
			case "replay":
				if _, ok := takeTicket(key, user, login); !ok {
					t.Fatal("initial ticket rejected")
				}
			}
			v, ok := takeTicket(key, user, login)
			if ok != (mode == "valid") {
				t.Fatal("bad ticket outcome", mode, ok)
			}
			if ok && v.revision != 3 {
				t.Fatal("policy binding lost")
			}
			if _, ok := takeTicket(key, user, login); ok {
				t.Fatal("ticket replay accepted")
			}
		})
	}
	if _, err := Issue(p, 0, "", ""); err == nil {
		t.Fatal("missing login accepted")
	}
	if _, err := IssueAtEpoch(p, 1, "user", "login", accounts.UserSecurityEpoch("user")+1); err == nil {
		t.Fatal("stale security generation accepted")
	}
}

func TestClosePeerCancelsActiveTerminal(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	state.Lock()
	state.active["test-active"] = active{"test-peer", cancel}
	state.Unlock()
	t.Cleanup(func() { state.Lock(); delete(state.active, "test-active"); state.Unlock() })
	ClosePeer("other")
	if ctx.Err() != nil {
		t.Fatal("unrelated peer canceled")
	}
	ClosePeer("test-peer")
	if ctx.Err() == nil {
		t.Fatal("terminal not canceled")
	}
}

func TestHostTerminalRejectsAnonymousBeforeUpgrade(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/admin/client/host-terminal", nil)
	Connect(c)
	if recorder.Code != http.StatusForbidden {
		t.Fatal(recorder.Code)
	}
}
