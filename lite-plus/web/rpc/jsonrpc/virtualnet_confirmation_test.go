package jsonrpc

import (
	"context"
	"crypto/sha256"
	"testing"
	"time"

	"github.com/nuomiiiii/lite/pkg/rpc"
	"github.com/nuomiiiii/lite/virtualnet"
)

func TestOverwriteConfirmationBinding(t *testing.T) {
	p := virtualnet.Profile{PeerID: "42", Address: "100.64.0.2", Fingerprint: "pinned"}
	s := virtualnet.Settings{ControlURL: "https://head.example.test"}
	ctx := rpc.NewContextWithMeta(context.Background(), &rpc.ContextMeta{Principal: rpc.NewUserPrincipal("admin"), SessionToken: "test-session"})
	for _, mode := range []string{"allowed", "unchecked", "expired", "different-session", "changed-profile", "changed-settings"} {
		t.Run(mode, func(t *testing.T) {
			c := virtualnetConfirmation{profile: p, settings: s, installation: virtualnet.Installation{Directory: true}, session: sha256.Sum256([]byte("test-session")), expires: time.Now().Add(time.Minute)}
			pp, ss := p, s
			if mode == "expired" {
				c.expires = time.Now().Add(-time.Minute)
			}
			if mode == "different-session" {
				c.session = sha256.Sum256([]byte("other"))
			}
			if mode == "changed-profile" {
				pp.Address = "100.64.0.99"
			}
			if mode == "changed-settings" {
				ss.ControlURL = "https://other.example.test"
			}
			virtualnetConfirmations.Lock()
			virtualnetConfirmations.items[mode] = c
			virtualnetConfirmations.Unlock()
			err := consumeVirtualnetConfirmation(ctx, mode, pp, ss, mode != "unchecked")
			if (err == nil) != (mode == "allowed") {
				t.Fatalf("unexpected confirmation outcome: %v", err)
			}
			if consumeVirtualnetConfirmation(ctx, mode, pp, ss, true) == nil {
				t.Fatal("confirmation replay allowed")
			}
		})
	}
}

func TestLifecycleConfirmationCannotChangeAction(t *testing.T) {
	p := virtualnet.Profile{PeerID: "42"}
	s := virtualnet.Settings{}
	ctx := rpc.NewContextWithMeta(context.Background(), &rpc.ContextMeta{Principal: rpc.NewUserPrincipal("admin"), SessionToken: "session"})
	for _, action := range []string{"pause", "resume"} {
		virtualnetConfirmations.Lock()
		virtualnetConfirmations.items[action] = virtualnetConfirmation{profile: p, settings: s, session: sha256.Sum256([]byte("session")), expires: time.Now().Add(time.Minute), action: action}
		virtualnetConfirmations.Unlock()
		if consumeVirtualnetActionConfirmation(ctx, action, p, s, false, "deploy") == nil {
			t.Fatal("lifecycle confirmation authorized destructive deployment")
		}
		virtualnetConfirmations.Lock()
		virtualnetConfirmations.items[action] = virtualnetConfirmation{profile: p, settings: s, session: sha256.Sum256([]byte("session")), expires: time.Now().Add(time.Minute), action: action}
		virtualnetConfirmations.Unlock()
		if err := consumeVirtualnetActionConfirmation(ctx, action, p, s, false, action); err != nil {
			t.Fatalf("matching lifecycle confirmation rejected: %v", err)
		}
	}
}
