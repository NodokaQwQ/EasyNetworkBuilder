// Package releasefeed reads the Git-maintained ENB release catalog. A catalog
// entry authorizes an immutable image, never a caller-supplied repository/tag.
package releasefeed

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const BaseURL = "https://raw.githubusercontent.com/NodokaQwQ/EasyNetworkBuilder/master/releases/"
const TTL = 30 * time.Minute

var versionPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`)
var imagePattern = regexp.MustCompile(`^docker\.io/nodokaqwq/enb@sha256:[0-9a-f]{64}$`)
var hashPattern = regexp.MustCompile(`^[a-zA-Z0-9._-]{7,100}$`)

type Release struct {
	Version      string   `json:"version"`
	Hash         string   `json:"hash"`
	Image        string   `json:"image"`
	Platform     string   `json:"platform"`
	Channel      string   `json:"channel"`
	Rollback     string   `json:"rollback"`
	FromVersions []string `json:"from_versions"`
	MinHead      string   `json:"min_head,omitempty"`
	Notes        string   `json:"notes"`
	PublishedAt  string   `json:"published_at"`
}

type Catalog struct {
	Schema    int       `json:"schema"`
	Component string    `json:"component"`
	Releases  []Release `json:"releases"`
}

func Compare(a, b string) (int, bool) {
	if !versionPattern.MatchString(a) || !versionPattern.MatchString(b) {
		return 0, false
	}
	x, y := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < 3; i++ {
		// Bounded integers avoid overflow in untrusted release metadata.
		left, e1 := strconv.ParseUint(x[i], 10, 32)
		right, e2 := strconv.ParseUint(y[i], 10, 32)
		if e1 != nil || e2 != nil {
			return 0, false
		}
		if left > right {
			return 1, true
		}
		if left < right {
			return -1, true
		}
	}
	return 0, true
}

func (r Release) Validate(component string) error {
	_, validVersion := Compare(r.Version, r.Version)
	_, validHead := Compare(r.MinHead, r.MinHead)
	if !validVersion || !hashPattern.MatchString(r.Hash) || !imagePattern.MatchString(r.Image) ||
		r.Platform != "linux/amd64" || r.Channel != "stable" || len(r.FromVersions) == 0 ||
		(component == "head" && r.Rollback != "restore-data-v1") ||
		(component == "node" && (r.Rollback != "restore-nodemgt-v1" || !validHead)) ||
		(component != "head" && component != "node") {
		return errors.New("invalid ENB release metadata")
	}
	if _, err := time.Parse(time.RFC3339, r.PublishedAt); err != nil {
		return errors.New("invalid release timestamp")
	}
	for _, source := range r.FromVersions {
		if source == "" || len(source) > 100 {
			return errors.New("explicit source versions required")
		}
	}
	return nil
}

func (r Release) Compatible(source, head, platform string) bool {
	if r.Platform != platform {
		return false
	}
	if comparison, ok := Compare(r.Version, source); ok && comparison <= 0 {
		return false
	}
	if r.MinHead != "" {
		if comparison, ok := Compare(head, r.MinHead); !ok || comparison < 0 {
			return false
		}
	}
	for _, v := range r.FromVersions {
		if v == source {
			return true
		}
	}
	return false
}

// LatestNodeForInstall has no source version: first installs must not use the
// migration allowlist. Never fall back to a compiled-in or mutable image.
func LatestNodeForInstall(releases []Release, head, platform string) (Release, error) {
	var latest Release
	for _, release := range releases {
		if err := release.Validate("node"); err != nil {
			return Release{}, err
		}
		comparison, valid := Compare(head, release.MinHead)
		if release.Platform != platform || !valid || comparison < 0 {
			continue
		}
		if latest.Version == "" {
			latest = release
		} else if order, _ := Compare(release.Version, latest.Version); order > 0 {
			latest = release
		}
	}
	if latest.Version == "" {
		return Release{}, errors.New("no published stable Node release compatible with this Head and platform")
	}
	return latest, nil
}

func Decode(data []byte, component string) ([]Release, error) {
	var catalog Catalog
	if err := json.Unmarshal(data, &catalog); err != nil {
		return nil, err
	}
	if catalog.Schema != 1 || catalog.Component != component || catalog.Releases == nil || len(catalog.Releases) > 200 {
		return nil, errors.New("invalid ENB catalog")
	}
	seen := map[string]bool{}
	for _, r := range catalog.Releases {
		if err := r.Validate(component); err != nil {
			return nil, err
		}
		key := r.Version + "/" + r.Platform
		if seen[key] {
			return nil, errors.New("duplicate release version/platform")
		}
		seen[key] = true
	}
	sort.Slice(catalog.Releases, func(i, j int) bool {
		c, _ := Compare(catalog.Releases[i].Version, catalog.Releases[j].Version)
		return c > 0
	})
	return catalog.Releases, nil
}

type cacheEntry struct {
	releases []Release
	checked  time.Time
	err      error
}

var cache = struct {
	sync.Mutex
	entries map[string]cacheEntry
}{entries: map[string]cacheEntry{}}

var fetchCatalog = download

// Fetch serializes requests to avoid many open Node dialogs causing a fetch
// storm. Errors are cached briefly, never represented as an empty fresh catalog.
func Fetch(ctx context.Context, component string, force bool) ([]Release, time.Time, error) {
	if component != "head" && component != "node" {
		return nil, time.Time{}, errors.New("invalid component")
	}
	address := os.Getenv("ENB_" + strings.ToUpper(component) + "_RELEASE_URL")
	if address == "" {
		address = BaseURL + component + "-stable.json"
	}
	u, err := url.Parse(address)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil {
		return nil, time.Time{}, errors.New("release URL must use HTTPS")
	}
	cache.Lock()
	defer cache.Unlock()
	key := component + address
	entry, ok := cache.entries[key]
	if ok && ((!force && time.Since(entry.checked) < TTL && entry.err == nil) || (entry.err != nil && time.Since(entry.checked) < 30*time.Second)) {
		return entry.releases, entry.checked, entry.err
	}
	checked := time.Now().UTC()
	releases, err := fetchCatalog(ctx, address, component)
	cache.entries[key] = cacheEntry{releases: releases, checked: checked, err: err}
	return releases, checked, err
}

func download(ctx context.Context, address, component string) ([]Release, error) {
	client := &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	req, err := http.NewRequestWithContext(ctx, "GET", address, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "ENB-release-check")
	resp, err := client.Do(req)
	if err != nil {
		return nil, errors.New("ENB release source unavailable")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ENB release source HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, (1<<20)+1))
	if err != nil || len(data) > 1<<20 {
		return nil, errors.New("invalid catalog size")
	}
	return Decode(data, component)
}
