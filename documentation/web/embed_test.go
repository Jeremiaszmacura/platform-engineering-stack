package web

import (
	"encoding/json"
	"io/fs"
	"path"
	"regexp"
	"slices"
	"strings"
	"testing"
)

var (
	linkPattern    = regexp.MustCompile(`(?:href|src)="([^"]*)"`)
	idPattern      = regexp.MustCompile(`id="([^"]+)"`)
	navPagePattern = regexp.MustCompile(`href: "([^"]+\.html)"`)
)

// pages returns every HTML page of the site with its content.
func pages(t *testing.T) map[string]string {
	t.Helper()
	site, err := Site()
	if err != nil {
		t.Fatalf("Site: %v", err)
	}
	names, err := fs.Glob(site, "*.html")
	if err != nil {
		t.Fatalf("glob pages: %v", err)
	}
	out := map[string]string{}
	for _, name := range names {
		data, err := fs.ReadFile(site, name)
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		out[name] = string(data)
	}
	return out
}

func TestEveryPageHasTheSharedFrame(t *testing.T) {
	for name, html := range pages(t) {
		for _, want := range []string{"<title>", `id="topbar"`, `id="sidebar"`, `<article class="page">`, `type="module"`} {
			if !strings.Contains(html, want) {
				t.Errorf("%s lacks %s", name, want)
			}
		}
	}
}

func TestLinksBetweenPagesResolve(t *testing.T) {
	site, err := Site()
	if err != nil {
		t.Fatalf("Site: %v", err)
	}
	all := pages(t)
	for name, html := range all {
		for _, m := range linkPattern.FindAllStringSubmatch(html, -1) {
			checkLink(t, site, all, name, m[1])
		}
	}
}

func checkLink(t *testing.T, site fs.FS, all map[string]string, from, link string) {
	t.Helper()
	if strings.Contains(link, "://") || strings.HasPrefix(link, "mailto:") {
		return
	}
	target, fragment, _ := strings.Cut(link, "#")
	if target == "" {
		target = from
	}
	target = path.Clean(target)
	if _, err := fs.Stat(site, target); err != nil {
		t.Errorf("%s links to %q: no such file", from, link)
		return
	}
	if fragment == "" {
		return
	}
	if !slices.ContainsFunc(idPattern.FindAllStringSubmatch(all[target], -1), func(id []string) bool { return id[1] == fragment }) {
		t.Errorf("%s links to %q: %s has no id %q", from, link, target, fragment)
	}
}

func TestNavigationListsEveryPage(t *testing.T) {
	site, err := Site()
	if err != nil {
		t.Fatalf("Site: %v", err)
	}
	script, err := fs.ReadFile(site, "assets/js/site.js")
	if err != nil {
		t.Fatalf("read site.js: %v", err)
	}
	var listed []string
	for _, m := range navPagePattern.FindAllStringSubmatch(string(script), -1) {
		listed = append(listed, m[1])
	}
	slices.Sort(listed)
	var files []string
	for name := range pages(t) {
		files = append(files, name)
	}
	slices.Sort(files)
	if !slices.Equal(listed, files) {
		t.Errorf("PAGES in site.js lists %v, but the site has %v", listed, files)
	}
}

func TestSnapshotIsAClusterMap(t *testing.T) {
	site, err := Site()
	if err != nil {
		t.Fatalf("Site: %v", err)
	}
	data, err := fs.ReadFile(site, "assets/snapshot.json")
	if err != nil {
		t.Fatalf("read snapshot: %v", err)
	}
	var snapshot struct {
		Nodes []json.RawMessage `json:"nodes"`
		Pods  []json.RawMessage `json:"pods"`
		Links []json.RawMessage `json:"links"`
	}
	if err := json.Unmarshal(data, &snapshot); err != nil {
		t.Fatalf("snapshot is not JSON: %v", err)
	}
	if len(snapshot.Nodes) == 0 || len(snapshot.Pods) == 0 || len(snapshot.Links) == 0 {
		t.Errorf("snapshot has %d nodes, %d pods, %d links; want a whole cluster", len(snapshot.Nodes), len(snapshot.Pods), len(snapshot.Links))
	}
}
