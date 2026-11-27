package virtualnet

import (
	"encoding/json"
	"errors"
	"path"
	"regexp"
	"strings"

	"gorm.io/gorm"
)

// Policy controls entry points, not what an authorized shell/OS account can do.
// Shell/files/commands never use deployment sudo. Only fixed managed Node
// Docker operations may use the explicitly configured deployment sudo settings.
type Policy struct {
	PeerID          string `json:"peer_id" gorm:"primaryKey"`
	NodeTerminal    bool   `json:"node_terminal"`
	NodeFiles       bool   `json:"node_files"`
	NodeExec        bool   `json:"node_exec"`
	NodeMCP         bool   `json:"node_mcp"`
	NodeFirewall    bool   `json:"node_firewall"`
	NodeProtection  bool   `json:"node_protection"`
	NodeImage       string `json:"node_image"`
	HostTerminal    bool   `json:"host_terminal"`
	HostFiles       bool   `json:"host_files"`
	HostExec        bool   `json:"host_exec"`
	NodeDocker      bool   `json:"node_docker"`
	ComposeProjects string `json:"-" gorm:"type:text"`
	Revision        uint64 `json:"revision"`
}

func (Policy) TableName() string { return "enb_virtualnet_permissions" }

// SSH identities/credentials changing must not transfer a prior host grant.
func RevokeHostPolicy(db *gorm.DB, peerID string) error {
	if !db.Migrator().HasTable(&Policy{}) {
		return nil
	}
	return db.Model(&Policy{}).Where("peer_id = ?", peerID).Updates(map[string]any{
		"host_terminal": false, "host_files": false, "host_exec": false, "node_docker": false, "compose_projects": "[]", "revision": gorm.Expr("revision + 1"),
	}).Error
}

type Project struct {
	Name      string `json:"name"`
	Directory string `json:"directory"`
}

type PolicyInput struct {
	Policy
	Projects []Project `json:"projects"`
}

var imageDigest = regexp.MustCompile(`^nodokaqwq/enb@sha256:[0-9a-f]{64}$`)
var projectName = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,62}$`)

func (p PolicyInput) Validate() error {
	if p.PeerID == "" {
		return errors.New("peer_id required")
	}
	if p.NodeImage != "" && !imageDigest.MatchString(p.NodeImage) {
		return errors.New("Node image must be an immutable nodokaqwq/enb SHA256 digest")
	}
	if len(p.Projects) > 16 {
		return errors.New("at most 16 Compose projects may be authorized")
	}
	seen := map[string]bool{}
	for _, project := range p.Projects {
		if !projectName.MatchString(project.Name) || project.Name == "enb-managed-node" || seen[project.Name] {
			return errors.New("unique explicit Compose project name required; managed Node is a separate permission")
		}
		seen[project.Name] = true
		if !strings.HasPrefix(project.Directory, "/") || path.Clean(project.Directory) != project.Directory || project.Directory == "/" || len(project.Directory) > 1024 || strings.ContainsAny(project.Directory, "\x00\r\n") {
			return errors.New("Compose project requires an absolute canonical directory (not /)")
		}
	}
	return nil
}

func LoadPolicy(db *gorm.DB, peerID string) (PolicyInput, error) {
	p := PolicyInput{Policy: Policy{PeerID: peerID}, Projects: []Project{}}
	err := db.First(&p.Policy, "peer_id = ?", peerID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return p, nil
	}
	if err != nil {
		return p, err
	}
	if p.ComposeProjects != "" {
		err = json.Unmarshal([]byte(p.ComposeProjects), &p.Projects)
	}
	if p.Projects == nil {
		p.Projects = []Project{}
	}
	return p, err
}

func SavePolicy(db *gorm.DB, p PolicyInput) error {
	if err := p.Validate(); err != nil {
		return err
	}
	b, err := json.Marshal(p.Projects)
	if err != nil {
		return err
	}
	p.ComposeProjects = string(b)
	p.Revision++
	return db.Save(&p.Policy).Error
}

func (p Policy) NodeAllowlist() string {
	var values []string
	for _, v := range []struct {
		name    string
		enabled bool
	}{
		{"terminal", p.NodeTerminal}, {"files", p.NodeFiles}, {"exec", p.NodeExec}, {"mcp", p.NodeMCP}, {"firewall", p.NodeFirewall}, {"protection", p.NodeProtection},
	} {
		if v.enabled {
			values = append(values, v.name)
		}
	}
	if len(values) == 0 {
		return "none"
	}
	return strings.Join(values, ",")
}
