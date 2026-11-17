// Package web holds the documentation site: one HTML page per topic and the assets they share.
package web

import (
	"embed"
	"fmt"
	"io/fs"
)

//go:embed site
var files embed.FS

// Site returns the site's files, rooted so that site/index.html is served at /.
func Site() (fs.FS, error) {
	site, err := fs.Sub(files, "site")
	if err != nil {
		return nil, fmt.Errorf("open embedded site: %w", err)
	}
	return site, nil
}
