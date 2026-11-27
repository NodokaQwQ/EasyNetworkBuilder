package virtualnet

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"regexp"
	"sort"
	"strings"
	"time"
)

var configIDPattern = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)

// RelayCandidates uses only current discovered addresses and explicit Docker
// grants. Credentials saved for an old address are never silently reused.
func RelayCandidates(peers []Peer, profiles []Profile, policies []Policy, target string) []Profile {
	allowed := map[string]bool{}
	for _, policy := range policies {
		allowed[policy.PeerID] = policy.NodeDocker
	}
	current := map[string]Peer{}
	for _, peer := range peers {
		if !peer.Local && peer.ID != target {
			current[peer.ID] = peer
		}
	}
	var result []Profile
	for _, p := range profiles {
		peer, ok := current[p.PeerID]
		addr, err := netip.ParseAddr(p.Address)
		if ok && err == nil && !addr.IsUnspecified() && allowed[p.PeerID] && p.CredentialsPresent() && p.Fingerprint != "" && (p.Address == peer.IPv4 || p.Address == peer.IPv6) {
			result = append(result, p)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		a, _ := netip.ParseAddr(result[i].Address)
		b, _ := netip.ParseAddr(result[j].Address)
		return a.Compare(b) < 0
	})
	return result
}

func imageReadyScript(image string) string {
	return "set -eu\ncommand -v timeout >/dev/null\n" +
		"if ! docker image inspect " + quote(image) + " >/dev/null 2>&1; then timeout -s TERM -k 2 20 docker pull --platform linux/amd64 " + quote(image) + " >/dev/null 2>&1; fi\n" +
		"test \"$(docker image inspect -f '{{.Os}}/{{.Architecture}}' " + quote(image) + ")\" = linux/amd64\n"
}

// EnsureDeploymentImage never stops or recreates a service. A failed fetch
// therefore leaves an existing Node and its data untouched.
func EnsureDeploymentImage(ctx context.Context, target Profile, donors []Profile, release NodeRelease) (string, error) {
	if err := release.Validate("node"); err != nil {
		return "", err
	}
	prepare := func(p Profile) error {
		attempt, cancel := context.WithTimeout(ctx, 35*time.Second)
		defer cancel()
		c, _, err := connect(attempt, p, false)
		if err != nil {
			return err
		}
		defer c.Close()
		return run(attempt, c, p, imageReadyScript(release.Image), "")
	}
	if prepare(target) == nil {
		return release.Image, nil
	}
	for _, donor := range donors {
		if ctx.Err() != nil {
			break
		}
		if prepare(donor) != nil {
			continue
		}
		if image, err := transferDeploymentImage(ctx, donor, target, release); err == nil {
			return image, nil
		}
	}
	return "", errors.New("Node image unavailable: direct pull and all authorized relay peers failed; previous deployment unchanged")
}

func transferDeploymentImage(ctx context.Context, donor, target Profile, release NodeRelease) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	source, _, err := connect(ctx, donor, false)
	if err != nil {
		return "", err
	}
	defer source.Close()
	destination, _, err := connect(ctx, target, false)
	if err != nil {
		return "", err
	}
	defer destination.Close()
	// Save by immutable digest, not by a mutable alias. The receiving Docker
	// engine verifies layer hashes; additionally verify the config ID exported
	// by the pinned source and the canonical repository digest after import.
	var info boundedBuffer
	info.limit = 256
	if err = runOutput(ctx, source, donor, "set -eu\ndocker image inspect -f '{{.Id}}' "+quote(release.Image), "", &info); err != nil {
		return "", err
	}
	id := strings.TrimSpace(info.String())
	if !configIDPattern.MatchString(id) {
		return "", errors.New("invalid source image identity")
	}
	expected, err := publishedConfigID(ctx, release.Image)
	if err != nil || expected != id {
		return "", errors.New("source image does not match published manifest config")
	}
	reader, writer := io.Pipe()
	done := make(chan error, 1)
	go func() {
		err := runStream(ctx, source, donor, "set -eu\ndocker image save "+quote(release.Image), strings.NewReader(""), writer)
		writer.CloseWithError(err)
		done <- err
	}()
	// Bound input to 2 GiB, retain no archive on Head or target filesystem.
	loadErr := runStream(ctx, destination, target, "set -eu\ndocker image load >/dev/null\ntest \"$(docker image inspect -f '{{.Id}}' "+quote(id)+")\" = "+quote(id)+"\ntest \"$(docker image inspect -f '{{.Os}}/{{.Architecture}}' "+quote(id)+")\" = linux/amd64\n", io.LimitReader(reader, 2<<30), io.Discard)
	reader.CloseWithError(loadErr)
	if err := <-done; err != nil {
		return "", err
	}
	if loadErr != nil {
		return "", loadErr
	}
	// docker save/load may not preserve RepoDigests. Use the verified config ID
	// for this deployment only; caller must render Compose with this identity.
	return id, nil
}

// Registry responses are content-address verified, including the child manifest
// of an OCI index. A donor cannot substitute an arbitrary image/config ID.
func publishedConfigID(ctx context.Context, image string) (string, error) {
	client := &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("registry redirect rejected") }}
	get := func(url, token string) ([]byte, error) {
		req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
		if err != nil {
			return nil, err
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		req.Header.Set("Accept", "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json")
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return nil, errors.New("registry unavailable")
		}
		b, err := io.ReadAll(io.LimitReader(resp.Body, (1<<20)+1))
		if len(b) > 1<<20 {
			return nil, errors.New("manifest too large")
		}
		return b, err
	}
	b, err := get("https://auth.docker.io/token?service=registry.docker.io&scope=repository:nodokaqwq/enb:pull", "")
	if err != nil {
		return "", err
	}
	var auth struct {
		Token string `json:"token"`
	}
	if json.Unmarshal(b, &auth) != nil || auth.Token == "" {
		return "", errors.New("registry authentication failed")
	}
	digest := strings.Split(image, "@")[1]
	for depth := 0; depth < 2; depth++ {
		b, err = get("https://registry-1.docker.io/v2/nodokaqwq/enb/manifests/"+digest, auth.Token)
		if err != nil {
			return "", err
		}
		if fmt.Sprintf("sha256:%x", sha256.Sum256(b)) != digest {
			return "", errors.New("manifest digest mismatch")
		}
		var manifest struct {
			Config struct {
				Digest string `json:"digest"`
			} `json:"config"`
			Manifests []struct {
				Digest   string `json:"digest"`
				Platform struct {
					OS           string `json:"os"`
					Architecture string `json:"architecture"`
				} `json:"platform"`
			} `json:"manifests"`
		}
		if json.Unmarshal(b, &manifest) != nil {
			return "", errors.New("invalid manifest")
		}
		if configIDPattern.MatchString(manifest.Config.Digest) {
			return manifest.Config.Digest, nil
		}
		digest = ""
		for _, m := range manifest.Manifests {
			if m.Platform.OS == "linux" && m.Platform.Architecture == "amd64" {
				digest = m.Digest
				break
			}
		}
		if !configIDPattern.MatchString(digest) {
			return "", errors.New("missing amd64 manifest")
		}
	}
	return "", errors.New("unsupported manifest nesting")
}
