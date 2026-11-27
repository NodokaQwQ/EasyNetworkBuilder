// Package virtualnet provides read-only EasyTier discovery and explicitly authorized SSH provisioning.
package virtualnet

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/netip"
	"net/url"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

type Peer struct {
	ID        string `json:"id"`
	Hostname  string `json:"hostname"`
	IPv4      string `json:"ipv4"`
	IPv6      string `json:"ipv6"`
	Version   string `json:"version"`
	Local     bool   `json:"local"`
	Hops      int    `json:"hops"`
	LatencyMS int    `json:"latency_ms"`
}

type Discovery struct {
	RPC      string `json:"rpc"`
	Instance string `json:"instance"`
	ReadOnly bool   `json:"read_only"`
	Peers    []Peer `json:"peers"`
}

// boundedBuffer fails closed rather than retaining arbitrary CLI output (which can contain secrets).
type boundedBuffer struct {
	bytes.Buffer
	limit int
}

func (b *boundedBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > b.limit {
		return 0, errors.New("output limit exceeded")
	}
	return b.Buffer.Write(p)
}

func Discover(ctx context.Context) (Discovery, error) {
	portal := os.Getenv("ENB_EASYTIER_RPC")
	if portal == "" {
		return Discovery{}, errors.New("configure ENB_EASYTIER_RPC to enable EasyTier discovery")
	}
	if _, _, err := net.SplitHostPort(portal); err != nil {
		return Discovery{}, errors.New("invalid EasyTier RPC address")
	}
	bin := os.Getenv("ENB_EASYTIER_CLI")
	if bin == "" {
		bin = "easytier-cli"
	}
	instance := os.Getenv("ENB_EASYTIER_INSTANCE")
	args := []string{"-p", portal, "-o", "json", "-v"}
	if instance != "" {
		args = append(args, "--instance-name", instance)
	}
	args = append(args, "route") // No user-supplied subcommands, shell, or configuration mutations.
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, args...)
	out := &boundedBuffer{limit: 4 << 20}
	cmd.Stdout = out
	cmd.Stderr = io.Discard
	if err := cmd.Run(); err != nil {
		return Discovery{}, errors.New("EasyTier CLI query failed; check binary version, RPC access and instance selection")
	}
	peers, err := ParseRoutes(out.Bytes())
	if err != nil {
		return Discovery{}, err
	}
	return Discovery{RPC: portal, Instance: instance, ReadOnly: true, Peers: peers}, nil
}

// Decode only an allowlist. In particular node_info.config and network secrets never leave this function.
func ParseRoutes(raw []byte) ([]Peer, error) {
	var doc struct {
		Node struct {
			PeerID   json.Number     `json:"peer_id"`
			Hostname string          `json:"hostname"`
			IPv4     string          `json:"ipv4_addr"`
			IPv6     json.RawMessage `json:"ipv6_addr"`
			Version  string          `json:"version"`
		} `json:"node_info"`
		Routes []struct {
			Route struct {
				PeerID   json.Number     `json:"peer_id"`
				Hostname string          `json:"hostname"`
				IPv4     json.RawMessage `json:"ipv4_addr"`
				IPv6     json.RawMessage `json:"ipv6_addr"`
				Version  string          `json:"version"`
				Cost     int             `json:"cost"`
				Latency  int             `json:"path_latency"`
			} `json:"route"`
		} `json:"peer_routes"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil || doc.Node.PeerID == "" {
		return nil, errors.New("unsupported EasyTier CLI JSON; select exactly one instance and use a compatible CLI")
	}
	ip4 := parseIP(json.RawMessage(strconv.Quote(doc.Node.IPv4)))
	peers := []Peer{{ID: doc.Node.PeerID.String(), Hostname: doc.Node.Hostname, IPv4: ip4, IPv6: parseIP(doc.Node.IPv6), Version: doc.Node.Version, Local: true}}
	seen := map[string]bool{doc.Node.PeerID.String(): true}
	for _, pair := range doc.Routes {
		r := pair.Route
		id := r.PeerID.String()
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		peers = append(peers, Peer{ID: id, Hostname: r.Hostname, IPv4: parseIP(r.IPv4), IPv6: parseIP(r.IPv6), Version: r.Version, Hops: r.Cost, LatencyMS: r.Latency})
	}
	if len(peers) > 2048 {
		return nil, errors.New("EasyTier peer limit exceeded")
	}
	return peers, nil
}

func parseIP(raw json.RawMessage) string {
	var text string
	if json.Unmarshal(raw, &text) == nil {
		if p, e := netip.ParsePrefix(text); e == nil {
			return p.Addr().String()
		}
		if a, e := netip.ParseAddr(text); e == nil {
			return a.String()
		}
		return ""
	}
	var obj struct {
		Address json.RawMessage `json:"address"`
		Addr    *uint32         `json:"addr"`
		Part1   *uint32         `json:"part1"`
		Part2   uint32          `json:"part2"`
		Part3   uint32          `json:"part3"`
		Part4   uint32          `json:"part4"`
	}
	if json.Unmarshal(raw, &obj) != nil {
		return ""
	}
	if len(obj.Address) > 0 {
		return parseIP(obj.Address)
	}
	if obj.Addr != nil {
		var b [4]byte
		binary.BigEndian.PutUint32(b[:], *obj.Addr)
		return netip.AddrFrom4(b).String()
	}
	if obj.Part1 != nil {
		var b [16]byte
		for i, v := range []uint32{*obj.Part1, obj.Part2, obj.Part3, obj.Part4} {
			binary.BigEndian.PutUint32(b[i*4:], v)
		}
		return netip.AddrFrom16(b).String()
	}
	return ""
}

func FindPeer(ctx context.Context, id, address string) (Peer, error) {
	d, err := Discover(ctx)
	if err != nil {
		return Peer{}, err
	}
	a, err := netip.ParseAddr(address)
	if err != nil || a.IsLoopback() || a.IsUnspecified() || a.IsMulticast() {
		return Peer{}, errors.New("invalid virtual address")
	}
	for _, p := range d.Peers {
		if p.ID == id && !p.Local && (p.IPv4 == a.String() || p.IPv6 == a.String()) {
			return p, nil
		}
	}
	return Peer{}, fmt.Errorf("target is not a current remote EasyTier peer")
}

func Endpoint() (string, error) {
	s := strings.TrimRight(os.Getenv("ENB_NODE_CONTROL_URL"), "/")
	if !strings.HasPrefix(s, "https://") {
		return "", errors.New("configure an HTTPS ENB_NODE_CONTROL_URL reachable through the virtual network")
	}
	u, err := url.Parse(s)
	if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", errors.New("invalid HTTPS node control URL")
	}
	return s, nil
}
