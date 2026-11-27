package jsonrpc

import (
	"context"
	"crypto/sha256"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/nuomiiiii/lite/database/dbcore"
	"github.com/nuomiiiii/lite/pkg/rpc"
	"github.com/nuomiiiii/lite/virtualnet"
)

type virtualnetConfirmation struct {
	profile      virtualnet.Profile
	settings     virtualnet.Settings
	installation virtualnet.Installation
	session      [32]byte
	expires      time.Time
	action       string
}

var virtualnetConfirmations = struct {
	sync.Mutex
	items map[string]virtualnetConfirmation
}{items: make(map[string]virtualnetConfirmation)}

func virtualnetInspection(ctx context.Context, req *rpc.JsonRpcRequest) (any, *rpc.JsonRpcError) {
	if e := denyAPIKey(ctx); e != nil {
		return nil, e
	}
	if !virtualnetDeployment.TryLock() {
		return nil, virtualnetError(errors.New("a deployment is in progress"))
	}
	defer virtualnetDeployment.Unlock()
	var options struct {
		Action string `json:"action"`
	}
	if err := req.BindParams(&options); err != nil {
		return nil, virtualnetError(errors.New("invalid request"))
	}
	if options.Action == "" {
		options.Action = "deploy"
	}
	if options.Action != "deploy" && options.Action != "pause" && options.Action != "resume" {
		return nil, virtualnetError(errors.New("invalid installation action"))
	}
	p, err := loadVirtualnetProfile(ctx, req)
	if err != nil {
		return nil, virtualnetError(err)
	}
	s, err := virtualnet.LoadSettings(dbcore.GetDBInstance())
	if err != nil {
		return nil, virtualnetError(err)
	}
	if _, err = s.Endpoint(); err != nil && options.Action == "deploy" {
		return nil, virtualnetError(err)
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	i, err := virtualnet.InspectInstallation(ctx, p)
	if err != nil {
		return nil, virtualnetError(err)
	}
	if options.Action != "deploy" {
		if !i.Directory || !i.Compose {
			return nil, virtualnetError(errors.New("retained Node installation not found; deploy a Node first"))
		}
		if options.Action == "resume" && p.NodeUUID == "" {
			return nil, virtualnetError(errors.New("Node panel association was deleted; restore requires the original server record"))
		}
	}
	virtualnetConfirmations.Lock()
	defer virtualnetConfirmations.Unlock()
	for id, v := range virtualnetConfirmations.items {
		if time.Now().After(v.expires) {
			delete(virtualnetConfirmations.items, id)
		}
	}
	if len(virtualnetConfirmations.items) >= 256 {
		return nil, virtualnetError(errors.New("too many pending confirmations"))
	}
	token := uuid.NewString()
	virtualnetConfirmations.items[token] = virtualnetConfirmation{profile: p, settings: s, installation: i, session: sha256.Sum256([]byte(rpc.MetaFromContext(ctx).SessionToken)), expires: time.Now().Add(5 * time.Minute), action: options.Action}
	return map[string]any{"confirmation_token": token, "installation": i, "requires_overwrite": i.Existing() || p.NodeUUID != "", "directory": "~/enb/node", "node_uuid": p.NodeUUID}, nil
}

func consumeVirtualnetConfirmation(ctx context.Context, token string, p virtualnet.Profile, s virtualnet.Settings, overwrite bool) error {
	return consumeVirtualnetActionConfirmation(ctx, token, p, s, overwrite, "deploy")
}

func consumeVirtualnetActionConfirmation(ctx context.Context, token string, p virtualnet.Profile, s virtualnet.Settings, overwrite bool, action string) error {
	virtualnetConfirmations.Lock()
	c, ok := virtualnetConfirmations.items[token]
	delete(virtualnetConfirmations.items, token)
	virtualnetConfirmations.Unlock()
	if c.action == "" {
		c.action = "deploy"
	} // compatibility with prior in-process test fixtures
	if !ok || time.Now().After(c.expires) || c.session != sha256.Sum256([]byte(rpc.MetaFromContext(ctx).SessionToken)) || c.profile != p || c.settings != s || c.action != action {
		return errors.New("deployment confirmation expired or configuration changed; inspect installation again")
	}
	if action != "deploy" {
		return nil
	}
	if (c.installation.Existing() || p.NodeUUID != "") && !overwrite {
		return errors.New("existing installation requires explicit overwrite confirmation")
	}
	if overwrite && !c.installation.Existing() && p.NodeUUID == "" {
		return errors.New("overwrite requires a detected installation; inspect installation again")
	}
	return nil
}
