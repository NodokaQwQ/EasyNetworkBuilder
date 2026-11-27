package virtualnet

import (
	"encoding/base64"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/nuomiiiii/lite/nodemgt/secretcrypt"
	"gorm.io/gorm"
)

type Profile struct {
	PeerID         string    `json:"peer_id" gorm:"primaryKey;type:varchar(64)"`
	Address        string    `json:"address"`
	Port           int       `json:"port"`
	Username       string    `json:"username"`
	Fingerprint    string    `json:"fingerprint"`
	AuthType       string    `json:"auth_type"`
	Password       string    `json:"-"`
	PrivateKey     string    `json:"-" gorm:"type:longtext"`
	Passphrase     string    `json:"-"`
	Sudo           bool      `json:"sudo"`
	SudoPassword   string    `json:"-"`
	NodeUUID       string    `json:"node_uuid"`
	Paused         bool      `json:"paused"`
	HasCredentials bool      `json:"has_credentials" gorm:"-"`
	UpdatedAt      time.Time `json:"updated_at"`
}

func (Profile) TableName() string { return "enb_virtualnet_profiles" }

func (p Profile) CredentialsPresent() bool {
	return (p.AuthType == "password" && p.Password != "") || (p.AuthType == "key" && p.PrivateKey != "")
}

// A panel deletion is not an uninstall. Release stale panel associations while
// retaining SSH credentials and history; remote Preflight still refuses overwrite.
// Never release an in-flight registration, including the short pre-association gap.
func ReconcileNodeAssociations(db *gorm.DB) error {
	if !db.Migrator().HasTable(&Profile{}) || !db.Migrator().HasTable("clients") {
		return nil
	}
	q := db.Model(&Profile{}).Where("node_uuid <> ''").Where("NOT EXISTS (SELECT 1 FROM clients WHERE clients.uuid = enb_virtualnet_profiles.node_uuid)")
	if db.Migrator().HasTable(&Job{}) {
		q = q.Where("NOT EXISTS (SELECT 1 FROM enb_virtualnet_jobs WHERE enb_virtualnet_jobs.peer_id = enb_virtualnet_profiles.peer_id AND enb_virtualnet_jobs.status = ?)", "running")
	}
	return q.Update("node_uuid", "").Error
}

// ForgetCredentials retains the deployment association, even for failed installs.
// Removing SSH access must never make an already managed peer eligible for reinstall.
func ForgetCredentials(db *gorm.DB, peerID string) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if err := RevokeHostPolicy(tx, peerID); err != nil {
			return err
		}
		return tx.Model(&Profile{}).Where("peer_id = ?", peerID).Updates(map[string]any{
			"password": "", "private_key": "", "passphrase": "", "sudo_password": "", "auth_type": "", "sudo": false,
		}).Error
	})
}

func UpdateJob(db *gorm.DB, id, nodeID, status, stage, message string) error {
	result := db.Model(&Job{}).Where("id = ?", id).Updates(map[string]any{
		"status": status, "stage": stage, "error": message, "node_uuid": nodeID,
	})
	if result.Error != nil || result.RowsAffected != 1 {
		return errors.New("could not persist deployment status; inspect remote installation before retrying")
	}
	return nil
}

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
	in.Username = strings.TrimSpace(in.Username)
	in.Fingerprint = strings.TrimSpace(in.Fingerprint)
	if !unixUser.MatchString(in.Username) || in.Port < 1 || in.Port > 65535 || !validFingerprint(in.Fingerprint) {
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
	paused := old.Paused
	// Never silently reuse credentials for a different peer endpoint or host key.
	if old.Address != in.Address || old.Port != in.Port || old.Username != in.Username || old.Fingerprint != in.Fingerprint || old.AuthType != in.AuthType {
		old = Profile{}
	}
	p := Profile{PeerID: in.PeerID, Address: in.Address, Port: in.Port, Username: in.Username, Fingerprint: in.Fingerprint, AuthType: in.AuthType, Sudo: in.Sudo, NodeUUID: nodeUUID, Paused: paused}
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
	return db.Transaction(func(tx *gorm.DB) error {
		if err := RevokeHostPolicy(tx, p.PeerID); err != nil {
			return err
		}
		return tx.Save(&p).Error
	})
}

func validFingerprint(value string) bool {
	if !strings.HasPrefix(value, "SHA256:") {
		return false
	}
	digest, err := base64.RawStdEncoding.DecodeString(strings.TrimPrefix(value, "SHA256:"))
	return err == nil && len(digest) == 32
}
