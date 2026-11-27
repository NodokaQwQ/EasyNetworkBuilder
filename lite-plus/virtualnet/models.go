package virtualnet

import (
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/nuomiiiii/lite/nodemgt/secretcrypt"
	"gorm.io/gorm"
)

type Profile struct {
	PeerID       string    `json:"peer_id" gorm:"primaryKey;type:varchar(64)"`
	Address      string    `json:"address"`
	Port         int       `json:"port"`
	Username     string    `json:"username"`
	Fingerprint  string    `json:"fingerprint"`
	AuthType     string    `json:"auth_type"`
	Password     string    `json:"-"`
	PrivateKey   string    `json:"-" gorm:"type:longtext"`
	Passphrase   string    `json:"-"`
	Sudo         bool      `json:"sudo"`
	SudoPassword string    `json:"-"`
	NodeUUID     string    `json:"node_uuid"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (Profile) TableName() string { return "enb_virtualnet_profiles" }

type Job struct {
	ID        string    `json:"id" gorm:"primaryKey;type:varchar(36)"`
	PeerID    string    `json:"peer_id" gorm:"index"`
	Status    string    `json:"status"`
	Stage     string    `json:"stage"`
	Error     string    `json:"error"`
	NodeUUID  string    `json:"node_uuid"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (Job) TableName() string { return "enb_virtualnet_jobs" }

type ProfileInput struct {
	PeerID       string `json:"peer_id"`
	Address      string `json:"address"`
	Port         int    `json:"port"`
	Username     string `json:"username"`
	Fingerprint  string `json:"fingerprint"`
	AuthType     string `json:"auth_type"`
	Password     string `json:"password"`
	PrivateKey   string `json:"private_key"`
	Passphrase   string `json:"passphrase"`
	Sudo         bool   `json:"sudo"`
	SudoPassword string `json:"sudo_password"`
}

var unixUser = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$`)

func SaveProfile(db *gorm.DB, in ProfileInput) error {
	if !unixUser.MatchString(in.Username) || in.Port < 1 || in.Port > 65535 || !strings.HasPrefix(in.Fingerprint, "SHA256:") {
		return errors.New("valid username, port and verified SHA256 host fingerprint required")
	}
	if in.AuthType != "password" && in.AuthType != "key" {
		return errors.New("auth_type must be password or key")
	}
	if len(in.PrivateKey) > 64<<10 || len(in.Password) > 4096 || len(in.Passphrase) > 4096 || len(in.SudoPassword) > 4096 {
		return errors.New("credential exceeds size limit")
	}
	var old Profile
	err := db.First(&old, "peer_id = ?", in.PeerID).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	nodeUUID := old.NodeUUID
	// Never silently reuse credentials for a different peer endpoint or host key.
	if old.Address != in.Address || old.Port != in.Port || old.Username != in.Username || old.Fingerprint != in.Fingerprint || old.AuthType != in.AuthType {
		old = Profile{}
	}
	p := Profile{PeerID: in.PeerID, Address: in.Address, Port: in.Port, Username: in.Username, Fingerprint: in.Fingerprint, AuthType: in.AuthType, Sudo: in.Sudo, NodeUUID: nodeUUID}
	for _, f := range []struct {
		input, previous string
		dst             *string
	}{{in.Password, old.Password, &p.Password}, {in.PrivateKey, old.PrivateKey, &p.PrivateKey}, {in.Passphrase, old.Passphrase, &p.Passphrase}, {in.SudoPassword, old.SudoPassword, &p.SudoPassword}} {
		if f.input == "" {
			*f.dst = f.previous
			continue
		}
		// Seal treats its prefix as already encrypted; reject it on untrusted plaintext input.
		if strings.HasPrefix(f.input, secretcrypt.Prefix) {
			return errors.New("invalid plaintext credential")
		}
		v, e := secretcrypt.Seal(f.input)
		if e != nil {
			return errors.New("could not encrypt credential")
		}
		*f.dst = v
	}
	if p.AuthType == "password" {
		p.PrivateKey = ""
		p.Passphrase = ""
		if p.Password == "" {
			return errors.New("password required")
		}
	} else {
		p.Password = ""
		if p.PrivateKey == "" {
			return errors.New("private key required")
		}
	}
	if !p.Sudo {
		p.SudoPassword = ""
	}
	return db.Save(&p).Error
}
