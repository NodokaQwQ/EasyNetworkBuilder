package virtualnet

import (
	"errors"
	"net"
	"net/netip"
	"net/url"
	"strconv"
	"strings"

	"gorm.io/gorm"
)

// Settings applies only to new Node installations; never to EasyTier itself.
type Settings struct {
	ID               uint   `json:"-" gorm:"primaryKey"`
	ControlURL       string `json:"control_url"`
	ControlIP        string `json:"control_ip"`
	EasyTierRPC      string `json:"easytier_rpc"`
	EasyTierInstance string `json:"easytier_instance"`
}

func (Settings) TableName() string { return "enb_virtualnet_settings" }

func LoadSettings(db *gorm.DB) (Settings, error) {
	var s Settings
	if err := db.First(&s, 1).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return Settings{}, errors.New("could not load Node deployment settings")
	}
	return s, nil
}

func SaveSettings(db *gorm.DB, s Settings) error {
	s.EasyTierRPC = strings.TrimSpace(s.EasyTierRPC)
	s.EasyTierInstance = strings.TrimSpace(s.EasyTierInstance)
	if s.EasyTierRPC != "" {
		host, port, err := net.SplitHostPort(s.EasyTierRPC)
		p, pe := strconv.Atoi(port)
		if err != nil || host == "" || pe != nil || p < 1 || p > 65535 {
			return errors.New("EasyTier RPC must be host:port")
		}
	}
	if len(s.EasyTierInstance) > 128 || strings.ContainsAny(s.EasyTierInstance, "\x00\r\n") {
		return errors.New("invalid EasyTier instance name")
	}
	s.ControlURL = strings.TrimRight(strings.TrimSpace(s.ControlURL), "/")
	s.ControlIP = strings.TrimSpace(s.ControlIP)
	// Clearing the configuration explicitly disables deployment.
	if s.ControlURL != "" || s.ControlIP != "" {
		if _, err := s.Endpoint(); err != nil {
			return err
		}
	}
	s.ID = 1
	if err := db.Save(&s).Error; err != nil {
		return errors.New("could not save Node deployment settings")
	}
	return nil
}

func (s Settings) Endpoint() (string, error) {
	if len(s.ControlURL) > 2048 || len(s.ControlIP) > 128 {
		return "", errors.New("Node deployment setting exceeds size limit")
	}
	if s.ControlURL == "" {
		return "", errors.New("configure Node control URL in virtual network deployment settings")
	}
	u, err := url.Parse(s.ControlURL)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return "", errors.New("Node control URL must be an HTTPS origin without credentials, path, query or fragment")
	}
	if u.Port() != "" {
		port, err := strconv.Atoi(u.Port())
		if err != nil || port < 1 || port > 65535 {
			return "", errors.New("invalid Node control URL port")
		}
	}
	if _, err := s.HostMapping(); err != nil {
		return "", err
	}
	return strings.TrimRight(s.ControlURL, "/"), nil
}

// Pin the hostname only inside the new Node container, preserving TLS SNI.
func (s Settings) HostMapping() (string, error) {
	if s.ControlIP == "" {
		return "", nil
	}
	a, err := netip.ParseAddr(s.ControlIP)
	if err != nil || a.IsLoopback() || a.IsUnspecified() || a.IsMulticast() || a.Zone() != "" {
		return "", errors.New("Node control IP must be a reachable virtual unicast address")
	}
	u, err := url.Parse(s.ControlURL)
	if err != nil || u.Hostname() == "" {
		return "", errors.New("invalid Node control URL")
	}
	if _, err := netip.ParseAddr(u.Hostname()); err == nil {
		return "", errors.New("use a certificate hostname with Node control IP mapping")
	}
	return u.Hostname() + "=" + a.String(), nil
}
