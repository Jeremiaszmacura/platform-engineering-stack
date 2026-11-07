package main

import (
	"slices"
	"testing"

	"cluster-map/internal/topology"
)

func TestParseReferences(t *testing.T) {
	got := parseReferences(" grafana=http://prometheus-service:9090, broken, =x ,")
	want := []topology.Reference{{App: "grafana", Value: "http://prometheus-service:9090"}}
	if !slices.Equal(got, want) {
		t.Errorf("parseReferences = %v, want %v", got, want)
	}
}
