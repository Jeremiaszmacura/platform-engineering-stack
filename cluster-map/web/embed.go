// Package web holds the cluster map page.
package web

import "embed"

// Files is the static page served at /.
//
//go:embed index.html
var Files embed.FS
