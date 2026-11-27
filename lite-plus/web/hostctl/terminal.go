// Package hostctl bridges a human-authorized browser terminal to pinned SSH.
// Tickets are single-use and login-bound, sent in the first WS frame, never URLs.
package hostctl

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/nuomiiiii/lite/database/accounts"
	"github.com/nuomiiiii/lite/database/dbcore"
	"github.com/nuomiiiii/lite/pkg/rpc"
	"github.com/nuomiiiii/lite/virtualnet"
	"github.com/nuomiiiii/lite/web/api"
	"github.com/nuomiiiii/lite/web/api/remote"
	"github.com/nuomiiiii/lite/web/security"
)

type ticket struct {
	profile     virtualnet.Profile
	revision    uint64
	user, login string
	epoch       uint64
	expires     time.Time
}
type active struct {
	peer   string
	cancel context.CancelFunc
}

var state = struct {
	sync.Mutex
	tickets map[string]ticket
	active  map[string]active
}{tickets: map[string]ticket{}, active: map[string]active{}}

func Issue(p virtualnet.Profile, revision uint64, user, login string) (string, error) {
	return IssueAtEpoch(p, revision, user, login, accounts.UserSecurityEpoch(user))
}

func IssueAtEpoch(p virtualnet.Profile, revision uint64, user, login string, epoch uint64) (string, error) {
	if user == "" || login == "" || !p.CredentialsPresent() {
		return "", errors.New("human login and SSH credentials required")
	}
	state.Lock()
	defer state.Unlock()
	for key, t := range state.tickets {
		if time.Now().After(t.expires) {
			delete(state.tickets, key)
		}
	}
	if len(state.tickets)+len(state.active) >= 64 {
		return "", errors.New("too many host terminals")
	}
	if accounts.UserSecurityEpoch(user) != epoch {
		return "", errors.New("administrator authorization changed")
	}
	key := rand.Text()
	state.tickets[key] = ticket{p, revision, user, accounts.SessionLookupKey(login), epoch, time.Now().Add(30 * time.Second)}
	return key, nil
}

func takeTicket(key, user, login string) (ticket, bool) {
	state.Lock()
	defer state.Unlock()
	t, ok := state.tickets[key]
	delete(state.tickets, key)
	return t, ok && time.Now().Before(t.expires) && t.user == user && t.login == accounts.SessionLookupKey(login)
}

func ClosePeer(peer string) {
	state.Lock()
	defer state.Unlock()
	for key, t := range state.tickets {
		if t.profile.PeerID == peer {
			delete(state.tickets, key)
		}
	}
	for _, s := range state.active {
		if s.peer == peer {
			s.cancel()
		}
	}
}

func valid(t ticket) bool {
	if !remote.RemoteManagementEnabled() || accounts.UserSecurityEpoch(t.user) != t.epoch || !accounts.SessionStillValid(t.user, t.login) {
		return false
	}
	var profile virtualnet.Profile
	if dbcore.GetDBInstance().First(&profile, "peer_id = ?", t.profile.PeerID).Error != nil || profile != t.profile {
		return false
	}
	policy, err := virtualnet.LoadPolicy(dbcore.GetDBInstance(), profile.PeerID)
	return err == nil && policy.HostTerminal && policy.Revision == t.revision
}

func Connect(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	p := api.GetPrincipal(c)
	login, _ := c.Cookie("session_token")
	if p == nil || p.Type != rpc.PrincipalUser || p.IsAPIKey || login == "" || !security.RemoteOriginAllowed(c.Request) {
		api.RespondError(c, http.StatusForbidden, "administrator session and same origin required")
		return
	}
	ws, err := api.UpgradeWebSocket(c, func(upgrader *websocket.Upgrader) { upgrader.CheckOrigin = security.RemoteOriginAllowed })
	if err != nil {
		return
	}
	defer ws.Close()
	ws.SetReadLimit(64 << 10)
	_ = ws.SetReadDeadline(time.Now().Add(10 * time.Second))
	_, b, err := ws.ReadMessage()
	if err != nil {
		return
	}
	var auth struct {
		Ticket string `json:"ticket"`
	}
	if json.Unmarshal(b, &auth) != nil {
		return
	}
	t, ok := takeTicket(auth.Ticket, p.UserUUID, login)
	if !ok || !valid(t) {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Minute)
	defer cancel()
	state.Lock()
	state.active[auth.Ticket] = active{t.profile.PeerID, cancel}
	state.Unlock()
	defer func() { state.Lock(); delete(state.active, auth.Ticket); state.Unlock() }()
	if _, err = virtualnet.FindPeer(ctx, t.profile.PeerID, t.profile.Address); err != nil {
		return
	}
	client, err := virtualnet.ConnectHost(ctx, t.profile)
	if err != nil {
		_ = ws.WriteJSON(map[string]string{"error": err.Error()})
		return
	}
	defer client.Close()
	// Cover SSH channel/PTY setup too, not only the established relay.
	watchDone := make(chan struct{})
	defer close(watchDone)
	go func() {
		select {
		case <-ctx.Done():
			ws.Close()
			client.Close()
		case <-watchDone:
		}
	}()
	sshSession, err := client.NewSession()
	if err != nil {
		return
	}
	defer sshSession.Close()
	stdin, err := sshSession.StdinPipe()
	if err != nil {
		return
	}
	stdout, err := sshSession.StdoutPipe()
	if err != nil {
		return
	}
	stderr, err := sshSession.StderrPipe()
	if err != nil {
		return
	}
	if err = sshSession.RequestPty("xterm-256color", 24, 80, nil); err != nil {
		return
	}
	if !valid(t) || ctx.Err() != nil {
		return
	}
	if err = sshSession.Shell(); err != nil {
		return
	}
	var writeMu sync.Mutex
	write := func(kind int, b []byte) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		_ = ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
		return ws.WriteMessage(kind, b)
	}
	if write(websocket.TextMessage, []byte(`{"ready":true}`)) != nil {
		return
	}
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		defer cancel()
		for {
			select {
			case <-ctx.Done():
				_ = ws.Close()
				_ = client.Close()
				return
			case <-ticker.C:
				if !valid(t) {
					cancel()
				}
			}
		}
	}()
	stream := func(r io.Reader) {
		buf := make([]byte, 4096)
		for {
			n, e := r.Read(buf)
			if n > 0 {
				if write(websocket.BinaryMessage, buf[:n]) != nil {
					cancel()
					return
				}
			}
			if e != nil {
				return
			}
		}
	}
	go stream(stdout)
	go stream(stderr)
	go func() { _ = sshSession.Wait(); cancel() }()
	for {
		_ = ws.SetReadDeadline(time.Now().Add(45 * time.Second))
		kind, b, e := ws.ReadMessage()
		if e != nil {
			return
		}
		if !valid(t) {
			return
		}
		if kind == websocket.BinaryMessage {
			if _, e = stdin.Write(b); e != nil {
				return
			}
			continue
		}
		var msg struct {
			Type string `json:"type"`
			Cols int    `json:"cols"`
			Rows int    `json:"rows"`
		}
		if json.Unmarshal(b, &msg) == nil && msg.Type == "resize" && msg.Cols > 0 && msg.Cols <= 500 && msg.Rows > 0 && msg.Rows <= 200 {
			_ = sshSession.WindowChange(msg.Rows, msg.Cols)
		}
	}
}
