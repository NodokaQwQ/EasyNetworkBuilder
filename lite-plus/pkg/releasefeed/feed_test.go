package releasefeed

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func validRelease() Release {
	return Release{Version: "0.0.1", Hash: "abcdef123", Image: "docker.io/nodokaqwq/enb@sha256:" + strings.Repeat("a", 64), Platform: "linux/amd64", Channel: "stable", Rollback: "restore-nodemgt-v1", MinHead: "0.0.1", FromVersions: []string{"0.2.1-enb-test"}, PublishedAt: "2026-11-27T00:00:00Z"}
}

func TestLatestNodeForInstall(t *testing.T) {
	old := validRelease()
	newer := old
	newer.Version = "0.0.9"
	newer.Image = "docker.io/nodokaqwq/enb@sha256:" + strings.Repeat("b", 64)
	future := old
	future.Version = "0.0.10"
	future.MinHead = "0.0.3"
	for _, releases := range [][]Release{{newer, old, future}, {future, old, newer}} {
		got, err := LatestNodeForInstall(releases, "0.0.2", "linux/amd64")
		if err != nil || got.Image != newer.Image {
			t.Fatalf("latest compatible selection: %+v %v", got, err)
		}
	}
	for _, tc := range []struct {
		head, platform string
		releases       []Release
	}{
		{"0.0.2", "linux/amd64", nil},
		{"0.0.2", "linux/arm64", []Release{old}},
		{"unknown", "linux/amd64", []Release{old}},
		{"0.0.2", "linux/amd64", []Release{future}},
	} {
		if _, err := LatestNodeForInstall(tc.releases, tc.head, tc.platform); err == nil {
			t.Fatal("accepted unavailable or incompatible release")
		}
	}
	invalid := old
	invalid.Image = "docker.io/nodokaqwq/enb:node-latest"
	if _, err := LatestNodeForInstall([]Release{invalid}, "0.0.2", "linux/amd64"); err == nil {
		t.Fatal("accepted mutable image")
	}
}

func TestCachedChecksForceRefreshAndErrors(t *testing.T) {
	old := fetchCatalog
	t.Cleanup(func() { fetchCatalog = old; cache.entries = map[string]cacheEntry{} })
	t.Setenv("ENB_NODE_RELEASE_URL", "https://release.example/node.json")
	cache.entries = map[string]cacheEntry{}
	calls := 0
	fetchCatalog = func(context.Context, string, string) ([]Release, error) {
		calls++
		return []Release{validRelease()}, nil
	}
	for i := 0; i < 2; i++ {
		if _, _, err := Fetch(context.Background(), "node", false); err != nil {
			t.Fatal(err)
		}
	}
	if calls != 1 {
		t.Fatal("cache not used", calls)
	}
	if _, _, err := Fetch(context.Background(), "node", true); err != nil || calls != 2 {
		t.Fatal("force failed", calls, err)
	}
	fetchCatalog = func(context.Context, string, string) ([]Release, error) { calls++; return nil, errors.New("offline") }
	if _, _, err := Fetch(context.Background(), "node", true); err == nil {
		t.Fatal("network error hidden")
	}
	if _, _, err := Fetch(context.Background(), "node", false); err == nil || calls != 3 {
		t.Fatal("error cache failed", calls, err)
	}
	for key, entry := range cache.entries {
		entry.checked = time.Now().Add(-time.Minute)
		cache.entries[key] = entry
	}
	if _, _, err := Fetch(context.Background(), "node", false); err == nil || calls != 4 {
		t.Fatal("error retry failed")
	}
	t.Setenv("ENB_NODE_RELEASE_URL", "http://insecure.example/node.json")
	if _, _, err := Fetch(context.Background(), "node", false); err == nil {
		t.Fatal("insecure feed accepted")
	}
}

func TestCompatibilityAndVersionReset(t *testing.T) {
	r := validRelease()
	if !r.Compatible("0.2.1-enb-test", "0.0.1", "linux/amd64") {
		t.Fatal("explicit legacy migration rejected")
	}
	for _, source := range []string{"0.0.1", "0.0.2", "0.2.1", "unknown"} {
		if r.Compatible(source, "0.0.1", "linux/amd64") {
			t.Fatal("incompatible source accepted", source)
		}
	}
	if r.Compatible("0.2.1-enb-test", "0.0.0", "linux/amd64") || r.Compatible("0.2.1-enb-test", "0.0.1", "linux/arm64") {
		t.Fatal("compatibility bypass")
	}
}

func TestStrictCatalogAndImmutableImages(t *testing.T) {
	for _, mode := range []string{"valid", "mutable", "duplicate", "component", "version", "timestamp", "head"} {
		t.Run(mode, func(t *testing.T) {
			r := validRelease()
			c := Catalog{Schema: 1, Component: "node", Releases: []Release{r}}
			switch mode {
			case "mutable":
				c.Releases[0].Image = "docker.io/nodokaqwq/enb:node-latest"
			case "duplicate":
				c.Releases = append(c.Releases, r)
			case "component":
				c.Component = "head"
			case "version":
				c.Releases[0].Version = "0.2.1-enb-test"
			case "timestamp":
				c.Releases[0].PublishedAt = "invalid"
			case "head":
				c.Releases[0].MinHead = "unknown"
			}
			data, _ := json.Marshal(c)
			_, err := Decode(data, "node")
			if (err == nil) != (mode == "valid") {
				t.Fatal("unexpected validation", err)
			}
		})
	}
}

func TestVersionOrdering(t *testing.T) {
	if c, ok := Compare("0.0.10", "0.0.2"); !ok || c <= 0 {
		t.Fatal(c, ok)
	}
	for _, v := range []string{"v0.0.1", "00.0.1", "0.0.1-beta", "4294967296.0.0"} {
		if _, ok := Compare(v, v); ok {
			t.Fatal("invalid version accepted", v)
		}
	}
}
